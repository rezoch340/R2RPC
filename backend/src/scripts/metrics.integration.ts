// 内部集成检查（非 E2E）:直接构造聚合数据验证指标算法。
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

type IntegrationDatabase = ReturnType<typeof drizzle>;

const PROJECT_NAME = 'metrics-smoke-proj';
const ACTION_NAME = 'act';
const CLIENT_ID = 'metrics-smoke-dev';

class CheckReporter {
  allChecksPassed = true;

  check(condition: boolean, message: string): void {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      this.allChecksPassed = false;
    }
  }
}

// 聚合管道冒烟(无 API 面 → 直连 PG):① recordCompletion 累加;② rebuildRecent 从 request_logs 重灌。
async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool);
  const metricsService = new MetricsService({
    database,
  } as unknown as DbService);
  const reporter = new CheckReporter();

  await clean(database);
  await verifyIncrementalAggregation(metricsService, database, reporter);
  await verifyRecentRebuild(metricsService, database, reporter);
  await clean(database);
  await connectionPool.end();

  console.log(
    reporter.allChecksPassed
      ? '\n=== METRICS SMOKE PASSED ==='
      : '\n=== METRICS SMOKE FAILED ===',
  );
  process.exit(reporter.allChecksPassed ? 0 : 1);
}

async function clean(database: IntegrationDatabase): Promise<void> {
  await database
    .delete(rpcDailyMetrics)
    .where(eq(rpcDailyMetrics.projectName, PROJECT_NAME));
  await database
    .delete(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJECT_NAME));
  await database
    .delete(requestLogs)
    .where(eq(requestLogs.projectName, PROJECT_NAME));
}

function requestLogJob(
  status: string,
  latencyMilliseconds: number,
): RequestLogJob {
  const timestamp = new Date().toISOString();
  return {
    requestId: `metrics-${Math.round(latencyMilliseconds)}-${status}`,
    project: PROJECT_NAME,
    action: ACTION_NAME,
    clientId: CLIENT_ID,
    clientRequestId: null,
    requesterUserId: null,
    accessTokenId: null,
    status,
    httpCode: 200,
    latencyMs: latencyMilliseconds,
    error: null,
    requestPayload: null,
    responsePayload: null,
    appAudit: null,
    createdAt: timestamp,
    finishedAt: timestamp,
  };
}

async function verifyIncrementalAggregation(
  metricsService: MetricsService,
  database: IntegrationDatabase,
  reporter: CheckReporter,
): Promise<void> {
  await metricsService.recordCompletion(requestLogJob('ok', 10));
  await metricsService.recordCompletion(requestLogJob('ok', 20));
  await metricsService.recordCompletion(requestLogJob('ok', 30));
  await metricsService.recordCompletion(requestLogJob('timeout', 40));
  await metricsService.recordCompletion(requestLogJob('error', 50));

  const [rpcMetric] = await database
    .select()
    .from(rpcDailyMetrics)
    .where(
      and(
        eq(rpcDailyMetrics.projectName, PROJECT_NAME),
        eq(rpcDailyMetrics.clientId, CLIENT_ID),
      ),
    );
  if (!rpcMetric) {
    reporter.check(false, 'rpc_daily 有累加行');
    return;
  }

  reporter.check(true, 'rpc_daily 有累加行');
  reporter.check(
    rpcMetric.totalRequests === 5,
    `total=5(实际 ${rpcMetric.totalRequests})`,
  );
  reporter.check(
    rpcMetric.successRequests === 3,
    `success=3(实际 ${rpcMetric.successRequests})`,
  );
  reporter.check(
    rpcMetric.timeoutRequests === 1,
    `timeout=1(实际 ${rpcMetric.timeoutRequests})`,
  );
  reporter.check(
    rpcMetric.failedRequests === 1,
    `failed=1(error 归 failed,实际 ${rpcMetric.failedRequests})`,
  );
  reporter.check(
    Number(rpcMetric.totalLatencyMs) === 150,
    `total_latency=150(实际 ${rpcMetric.totalLatencyMs})`,
  );
  reporter.check(
    rpcMetric.maxLatencyMs === 50,
    `max_latency=50(实际 ${rpcMetric.maxLatencyMs})`,
  );
  const currentUtcDate = new Date().toISOString().slice(0, 10);
  reporter.check(
    rpcMetric.statDate === currentUtcDate,
    `stat_date=今天 UTC(实际 ${rpcMetric.statDate})`,
  );

  const [deviceMetric] = await database
    .select()
    .from(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJECT_NAME));
  reporter.check(
    deviceMetric?.totalRequests === 5,
    `device_daily total=5(实际 ${deviceMetric?.totalRequests})`,
  );
}

async function verifyRecentRebuild(
  metricsService: MetricsService,
  database: IntegrationDatabase,
  reporter: CheckReporter,
): Promise<void> {
  await database
    .delete(rpcDailyMetrics)
    .where(eq(rpcDailyMetrics.projectName, PROJECT_NAME));
  await database
    .delete(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJECT_NAME));
  await database.insert(requestLogs).values([
    {
      requestId: 'metrics-rebuild-1',
      projectName: PROJECT_NAME,
      actionName: ACTION_NAME,
      clientId: CLIENT_ID,
      status: 'ok',
      latencyMs: 11,
      createdAt: new Date(),
    },
    {
      requestId: 'metrics-rebuild-2',
      projectName: PROJECT_NAME,
      actionName: ACTION_NAME,
      clientId: CLIENT_ID,
      status: 'timeout',
      latencyMs: 22,
      createdAt: new Date(),
    },
  ]);

  await metricsService.rebuildRecent(3);
  const [rebuiltMetric] = await database
    .select()
    .from(rpcDailyMetrics)
    .where(eq(rpcDailyMetrics.projectName, PROJECT_NAME));
  reporter.check(
    rebuiltMetric?.totalRequests === 2,
    `对账后 rpc_daily total=2(实际 ${rebuiltMetric?.totalRequests})`,
  );
  reporter.check(
    rebuiltMetric?.successRequests === 1 && rebuiltMetric.timeoutRequests === 1,
    '对账后 success=1 timeout=1',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
