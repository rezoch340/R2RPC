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
