import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MetricsService } from '../application/metrics/metrics.service';
import {
  deviceDailyMetrics,
  rpcDailyMetrics,
} from '../application/metrics/metrics.schema';
import { requestLogs } from '../application/request-logs/request-logs.schema';
import { RequestLogJob } from '../application/request-logs/request-log.types';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';

// 聚合管道冒烟(无 API 面 → 直连 PG):① recordCompletion 累加;② rebuildRecent 从 request_logs 重灌。
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  const svc = new MetricsService({ db } as unknown as DbService);

  const PROJ = 'metrics-smoke-proj';
  const ACT = 'act';
  const CID = 'metrics-smoke-dev';
  const DAY = new Date().toISOString().slice(0, 10);
  const clean = async () => {
    await db
      .delete(rpcDailyMetrics)
      .where(eq(rpcDailyMetrics.projectName, PROJ));
    await db
      .delete(deviceDailyMetrics)
      .where(eq(deviceDailyMetrics.projectName, PROJ));
    await db.delete(requestLogs).where(eq(requestLogs.projectName, PROJ));
  };
  await clean();

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };
  const job = (status: string, latency: number): RequestLogJob => ({
    requestId: `ms-${Math.round(latency)}-${status}`,
    project: PROJ,
    action: ACT,
    clientId: CID,
    requesterUserId: null,
    accessTokenId: null,
    status,
    httpCode: 200,
    latencyMs: latency,
    error: null,
    requestPayload: null,
    responsePayload: null,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

  // ① 累加:3 ok + 1 timeout + 1 error,延迟 10/20/30/40/50
  await svc.recordCompletion(job('ok', 10));
  await svc.recordCompletion(job('ok', 20));
  await svc.recordCompletion(job('ok', 30));
  await svc.recordCompletion(job('timeout', 40));
  await svc.recordCompletion(job('error', 50));

  const [r] = await db
    .select()
    .from(rpcDailyMetrics)
    .where(
      and(
        eq(rpcDailyMetrics.projectName, PROJ),
        eq(rpcDailyMetrics.clientId, CID),
      ),
    );
  check(!!r, 'rpc_daily 有累加行');
  check(r?.totalRequests === 5, `total=5(实际 ${r?.totalRequests})`);
  check(r?.successRequests === 3, `success=3(实际 ${r?.successRequests})`);
  check(r?.timeoutRequests === 1, `timeout=1(实际 ${r?.timeoutRequests})`);
  check(
    r?.failedRequests === 1,
    `failed=1(error 归 failed,实际 ${r?.failedRequests})`,
  );
  check(
    Number(r?.totalLatencyMs) === 150,
    `total_latency=150(实际 ${r?.totalLatencyMs})`,
  );
  check(r?.maxLatencyMs === 50, `max_latency=50(实际 ${r?.maxLatencyMs})`);
  check(r?.statDate === DAY, `stat_date=今天 UTC(实际 ${r?.statDate})`);

  const [d] = await db
    .select()
    .from(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJ));
  check(
    d?.totalRequests === 5,
    `device_daily total=5(实际 ${d?.totalRequests})`,
  );

  // ② 对账:清聚合(留 request_logs 种子)-> rebuildRecent -> 应从 request_logs 重灌
  await db.delete(rpcDailyMetrics).where(eq(rpcDailyMetrics.projectName, PROJ));
  await db
    .delete(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJ));
  await db.insert(requestLogs).values([
    {
      requestId: 'ms-rc-1',
      projectName: PROJ,
      actionName: ACT,
      clientId: CID,
      status: 'ok',
      latencyMs: 11,
      createdAt: new Date(),
    },
    {
      requestId: 'ms-rc-2',
      projectName: PROJ,
      actionName: ACT,
      clientId: CID,
      status: 'timeout',
      latencyMs: 22,
      createdAt: new Date(),
    },
  ]);
  await svc.rebuildRecent(3);
  const [rc] = await db
    .select()
    .from(rpcDailyMetrics)
    .where(eq(rpcDailyMetrics.projectName, PROJ));
  check(
    rc?.totalRequests === 2,
    `对账后 rpc_daily total=2(实际 ${rc?.totalRequests})`,
  );
  check(
    rc?.successRequests === 1 && rc?.timeoutRequests === 1,
    '对账后 success=1 timeout=1',
  );

  await clean();
  await pool.end();
  console.log(
    ok ? '\n=== METRICS SMOKE PASSED ===' : '\n=== METRICS SMOKE FAILED ===',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
