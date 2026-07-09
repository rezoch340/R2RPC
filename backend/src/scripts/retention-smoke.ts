import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { RequestLogsService } from '../application/request-logs/request-logs.service';
import { requestLogs } from '../application/request-logs/request-logs.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';

// 保留/裁剪冒烟:直连 PG,种子 -> 跑 cleanupOldRequests/trimScopes -> 断言 -> 清理。
// 前置:PG 已迁移。用法: pnpm retention:smoke
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  // 用真实 service,只喂它需要的 { db }(不启 Nest DI)
  const logs = new RequestLogsService({ db } as unknown as DbService);

  const TAG = 'retention-smoke'; // 用 project_name 打标,只碰自己造的数据
  const now = Date.now();

  await db.delete(requestLogs).where(eq(requestLogs.projectName, TAG)); // 清上轮残留

  const rows: (typeof requestLogs.$inferInsert)[] = [];
  // 2 条超龄(5 天前)-> 预期 cleanup 删掉
  for (let i = 0; i < 2; i++)
    rows.push({
      requestId: `${TAG}-old-${i}`,
      projectName: TAG,
      actionName: 'act',
      clientId: 'cli',
      status: 'ok',
      createdAt: new Date(now - 5 * 86_400_000),
    });
  // 150 条同 scope 新鲜 -> 预期 trim 后剩 100
  for (let i = 0; i < 150; i++)
    rows.push({
      requestId: `${TAG}-fresh-${i}`,
      projectName: TAG,
      actionName: 'act',
      clientId: 'cli',
      status: 'ok',
      createdAt: new Date(now - i * 1000),
    });
  await db.insert(requestLogs).values(rows);

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const cleaned = await logs.cleanupOldRequests(3);
  check(cleaned === 2, `cleanup 删 2 条超龄(实际 ${cleaned})`);

  const trimmed = await logs.trimScopes(100);
  check(trimmed === 50, `trim 裁 50 条 = 150-100(实际 ${trimmed})`);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(requestLogs)
    .where(eq(requestLogs.projectName, TAG));
  check(n === 100, `scope 最终剩 100 条(实际 ${n})`);

  await db.delete(requestLogs).where(eq(requestLogs.projectName, TAG)); // 清理种子
  await pool.end();
  console.log(
    ok
      ? '\n=== RETENTION SMOKE PASSED ==='
      : '\n=== RETENTION SMOKE FAILED ===',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
