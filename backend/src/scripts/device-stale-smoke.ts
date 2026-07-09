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
// 前置:PG 已迁移。用法: pnpm device:stale:smoke
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  const redis = new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password ?? undefined,
    db: cfg.redis.db,
  });
  // 用真实 service,只喂它需要的 { db } / { client }(不启 Nest DI)
  const svc = new DevicesService(
    { db } as unknown as DbService,
    { client: redis } as unknown as RedisService,
  );

  const CID = 'stale-smoke-probe';
  await db.delete(devices).where(eq(devices.clientId, CID)); // 清残留
  await redis.del(`presence:${CID}`); // 确保无 presence 键(= 实际掉线)
  await db
    .insert(devices)
    .values({ clientId: CID, online: true, status: 'online' });

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const n = await svc.markStaleOffline();
  check(n >= 1, `markStaleOffline 至少置 1 台(实际 ${n})`);

  const [row] = await db
    .select()
    .from(devices)
    .where(eq(devices.clientId, CID))
    .limit(1);
  check(
    !!row && row.online === false && row.status === 'stale',
    'probe 设备被置 online=false status=stale',
  );

  await db.delete(devices).where(eq(devices.clientId, CID)); // 清种子
  await redis.quit();
  await pool.end();
  console.log(
    ok
      ? '\n=== DEVICE STALE SMOKE PASSED ==='
      : '\n=== DEVICE STALE SMOKE FAILED ===',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
