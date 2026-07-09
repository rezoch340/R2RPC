import Redis from 'ioredis';
import { PresenceService } from '../infrastructure/ws/presence.service';
import { ConfigService } from '../infrastructure/config/config.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// 在途限流冒烟(无 API 面 → 直连 Redis):tryAcquireSlot 到上限即拒,release 后可再占。
async function main() {
  const cfg = new ConfigService();
  const redis = new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password ?? undefined,
    db: cfg.redis.db,
  });
  const svc = new PresenceService({ client: redis } as unknown as RedisService);

  const CID = 'maxinflight-smoke-probe';
  const MAX = 3; // 直接用小值测逻辑(clamp 只在网关入口,这里直接喂 max)
  await svc.resetInFlight(CID);

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const a1 = await svc.tryAcquireSlot(CID, MAX);
  const a2 = await svc.tryAcquireSlot(CID, MAX);
  const a3 = await svc.tryAcquireSlot(CID, MAX);
  check(a1 && a2 && a3, '占满 3 个槽(max=3)');
  const a4 = await svc.tryAcquireSlot(CID, MAX);
  check(a4 === false, '第 4 个超上限被拒(rejected)');
  await svc.releaseSlot(CID);
  const a5 = await svc.tryAcquireSlot(CID, MAX);
  check(a5 === true, 'release 一个后可再占');
  // 兜底不为负
  await svc.resetInFlight(CID);
  await svc.releaseSlot(CID);
  const a6 = await svc.tryAcquireSlot(CID, MAX);
  check(a6 === true, 'release 到负后兜底 0,仍可占');

  // 组饱和轮询:pickOnlineAcquire 跳过满设备,全满才 saturated
  const PID = 999999; // 测试用假 project id
  const D1 = 'pick-smoke-d1';
  const D2 = 'pick-smoke-d2';
  await svc.offline(D1, [PID]);
  await svc.offline(D2, [PID]);

  const e0 = await svc.pickOnlineAcquire(PID);
  check(e0 === 'no_device', '空组 → no_device');

  // 两台上线;d1 max=1 且占满,d2 max=8 空闲
  await svc.online(D1, [PID]);
  await svc.online(D2, [PID]);
  await svc.setMaxInFlight(D1, 1);
  await svc.setMaxInFlight(D2, 8);
  await svc.resetInFlight(D1);
  await svc.resetInFlight(D2);
  await svc.tryAcquireSlot(D1, 1); // d1 占满
  const r1 = await svc.pickOnlineAcquire(PID);
  check(
    typeof r1 !== 'string' && r1.clientId === D2,
    '跳过已满的 d1,选中并占 d2',
  );
  // 把 d2 也占满(max=8,上面 pick 已占 1,再占 7)
  for (let i = 0; i < 7; i++) await svc.tryAcquireSlot(D2, 8);
  const r2 = await svc.pickOnlineAcquire(PID);
  check(r2 === 'saturated', '全满 → saturated');

  await svc.offline(D1, [PID]);
  await svc.offline(D2, [PID]);

  await svc.resetInFlight(CID);
  await redis.quit();
  console.log(
    ok
      ? '\n=== MAXINFLIGHT SMOKE PASSED ==='
      : '\n=== MAXINFLIGHT SMOKE FAILED ===',
  );
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
