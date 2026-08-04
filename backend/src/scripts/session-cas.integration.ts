// 内部集成检查（非 E2E）:直连 Redis 验证 client:session 的 CAS 归属判定。
import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from '../infrastructure/ws/connection.registry';
import { ClusterBus } from '../infrastructure/ws/cluster-bus.service';
import { ConfigService } from '../infrastructure/config/config.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// unregister 的 CAS 决定 handleDisconnect 是否执行下线清理(presence.offline + markOffline)。
// 三种归属场景必须区分:自己持有 -> 清理;键已过期无人接手 -> 仍须清理;已被新连接接管 -> 不得清理。
// 前置:Redis 在跑。用法: pnpm test:integration:session-cas
async function main() {
  const configuration = new ConfigService();
  const redisClient = new Redis({
    host: configuration.redis.host,
    port: configuration.redis.port,
    password: configuration.redis.password ?? undefined,
    db: configuration.redis.db,
  });
  // 用真实 registry,只喂它需要的 { client };不启 Nest DI,也不调 onModuleInit(不订阅 ClusterBus)
  const registry = new ConnectionRegistry(
    { subscribe: () => Promise.resolve() } as unknown as ClusterBus,
    { client: redisClient } as unknown as RedisService,
  );

  let allChecksPassed = true;
  const check = (condition: boolean, message: string) => {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      allChecksPassed = false;
    }
  };
  // register 只往 socket 上挂 _sessionToken 并存进本地 Map,不碰 socket 的其他能力
  const fakeSocket = () => ({}) as unknown as WebSocket;

  const CLIENT_ID = 'session-cas-probe';
  await redisClient.del(`client:session:${CLIENT_ID}`);

  // 场景一:正常持有 -> 是 owner
  const heldSocket = fakeSocket();
  await registry.register(CLIENT_ID, heldSocket);
  check(
    (await registry.unregister(CLIENT_ID, heldSocket)) === true,
    '持有会话的连接断开时判定为 owner',
  );

  // 场景二:键因 TTL 过期而消失(硬断网时读超时晚于 30s TTL)-> 无人接手,仍须清理
  const expiredSocket = fakeSocket();
  await registry.register(CLIENT_ID, expiredSocket);
  await redisClient.del(`client:session:${CLIENT_ID}`); // 模拟 TTL 到期
  check(
    (await registry.unregister(CLIENT_ID, expiredSocket)) === true,
    '会话键已过期且无人接手时仍判定为 owner(否则下线清理被整体跳过)',
  );

  // 场景三:已被新连接接管 -> 旧连接不得清理,且不得误删新会话
  const staleSocket = fakeSocket();
  await registry.register(CLIENT_ID, staleSocket);
  const freshSocket = fakeSocket();
  await registry.register(CLIENT_ID, freshSocket); // 覆盖为新 token
  check(
    (await registry.unregister(CLIENT_ID, staleSocket)) === false,
    '会话已被新连接接管时旧连接不判定为 owner',
  );
  check(
    (await redisClient.exists(`client:session:${CLIENT_ID}`)) === 1,
    '旧连接的 unregister 未误删新连接的会话键',
  );

  await redisClient.del(`client:session:${CLIENT_ID}`); // 清种子
  await redisClient.quit();
  console.log(
    allChecksPassed
      ? '\n=== SESSION CAS SMOKE PASSED ==='
      : '\n=== SESSION CAS SMOKE FAILED ===',
  );
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
