// 内部集成检查（非 E2E）:直接构造持久层数据验证保留算法。
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { RequestLogsService } from '../application/request-logs/request-logs.service';
import { requestLogs } from '../application/request-logs/request-logs.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';

// 保留/裁剪冒烟:直连 PG,种子 -> 跑 cleanupOldRequests/trimScopes -> 断言 -> 清理。
// 前置:PG 已迁移。用法: pnpm test:integration:retention
async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool);
  // 用真实 service,只喂它需要的 { db }(不启 Nest DI)
  const requestLogsService = new RequestLogsService({
    database,
  } as unknown as DbService);

  const PROJECT_TAG = 'retention-smoke'; // 用 project_name 打标,只碰自己造的数据
  const currentTime = Date.now();

  await database
    .delete(requestLogs)
    .where(eq(requestLogs.projectName, PROJECT_TAG)); // 清上轮残留

  const seededRequestLogs: (typeof requestLogs.$inferInsert)[] = [];
  // 2 条超龄(5 天前)-> 预期 cleanup 删掉
  for (let recordIndex = 0; recordIndex < 2; recordIndex += 1) {
    seededRequestLogs.push({
      requestId: `${PROJECT_TAG}-old-${recordIndex}`,
      projectName: PROJECT_TAG,
      actionName: 'act',
      clientId: 'cli',
      status: 'ok',
      createdAt: new Date(currentTime - 5 * 86_400_000),
    });
  }
  // 150 条同 scope 新鲜 -> 预期 trim 后剩 100
  for (let recordIndex = 0; recordIndex < 150; recordIndex += 1) {
    seededRequestLogs.push({
      requestId: `${PROJECT_TAG}-fresh-${recordIndex}`,
      projectName: PROJECT_TAG,
      actionName: 'act',
      clientId: 'cli',
      status: 'ok',
      createdAt: new Date(currentTime - recordIndex * 1000),
    });
  }
  await database.insert(requestLogs).values(seededRequestLogs);

  let allChecksPassed = true;
  const check = (condition: boolean, message: string) => {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      allChecksPassed = false;
    }
  };

  const cleaned = await requestLogsService.cleanupOldRequests(3);
  check(cleaned === 2, `cleanup 删 2 条超龄(实际 ${cleaned})`);

  const trimmed = await requestLogsService.trimScopes(100);
  check(trimmed === 50, `trim 裁 50 条 = 150-100(实际 ${trimmed})`);

  const [{ count: remainingRequestCount }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(requestLogs)
    .where(eq(requestLogs.projectName, PROJECT_TAG));
  check(
    remainingRequestCount === 100,
    `scope 最终剩 100 条(实际 ${remainingRequestCount})`,
  );

  await database
    .delete(requestLogs)
    .where(eq(requestLogs.projectName, PROJECT_TAG)); // 清理种子
  await connectionPool.end();
  console.log(
    allChecksPassed
      ? '\n=== RETENTION SMOKE PASSED ==='
      : '\n=== RETENTION SMOKE FAILED ===',
  );
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
