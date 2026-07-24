// 内部集成检查（非 E2E）:直连 PG/Redis 验证 stale 对账算法。
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DevicesService } from '../application/devices/devices.service';
import { devices } from '../application/devices/devices.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// stale 扫描冒烟(无 API 面 → 直连 PG+Redis):种子一台 online 但无 presence 的设备 -> markStaleOffline -> 断言 stale。
// 前置:PG 已迁移。用法: pnpm test:integration:device-stale
async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool);
  const redisClient = new Redis({
    host: configuration.redis.host,
    port: configuration.redis.port,
    password: configuration.redis.password ?? undefined,
    db: configuration.redis.db,
  });
  // 用真实 service,只喂它需要的 { db } / { client }(不启 Nest DI)
  const devicesService = new DevicesService(
    { database } as unknown as DbService,
    { client: redisClient } as unknown as RedisService,
  );

  const CLIENT_ID = 'stale-smoke-probe';
  await database.delete(devices).where(eq(devices.clientId, CLIENT_ID)); // 清残留
  await redisClient.del(`presence:${CLIENT_ID}`); // 确保无 presence 键(= 实际掉线)
  await database
    .insert(devices)
    .values({ clientId: CLIENT_ID, online: true, status: 'online' });

  let allChecksPassed = true;
  const check = (condition: boolean, message: string) => {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      allChecksPassed = false;
    }
  };

  const staleDeviceCount = await devicesService.markStaleOffline();
  check(
    staleDeviceCount >= 1,
    `markStaleOffline 至少置 1 台(实际 ${staleDeviceCount})`,
  );

  const [deviceRecord] = await database
    .select()
    .from(devices)
    .where(eq(devices.clientId, CLIENT_ID))
    .limit(1);
  check(
    !!deviceRecord &&
      deviceRecord.online === false &&
      deviceRecord.status === 'stale',
    'probe 设备被置 online=false status=stale',
  );

  await database.delete(devices).where(eq(devices.clientId, CLIENT_ID)); // 清种子
  await redisClient.quit();
  await connectionPool.end();
  console.log(
    allChecksPassed
      ? '\n=== DEVICE STALE SMOKE PASSED ==='
      : '\n=== DEVICE STALE SMOKE FAILED ===',
  );
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
