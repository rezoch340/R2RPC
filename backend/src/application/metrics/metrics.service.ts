import { Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { RequestLogJob } from '../request-logs/request-log.types';
import { requestLogs } from '../request-logs/request-logs.schema';
import { deviceDailyMetrics, rpcDailyMetrics } from './metrics.schema';

// 指标基础聚合:MVP 直接对请求日志脊柱做查询时聚合。
// ponytail: 查询时聚合;量大后改为 worker 异步聚合进 metrics 表(schema 已备)。
@Injectable()
export class MetricsService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async overview() {
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${requestLogs.status} = 'ok')::int`,
        failed: sql<number>`count(*) filter (where ${requestLogs.status} <> 'ok')::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)::int`,
      })
      .from(requestLogs);

    const byStatus = await this.db
      .select({ status: requestLogs.status, count: sql<number>`count(*)::int` })
      .from(requestLogs)
      .groupBy(requestLogs.status)
      .orderBy(desc(sql`count(*)`));

    const byProject = await this.db
      .select({
        project: requestLogs.projectName,
        count: sql<number>`count(*)::int`,
      })
      .from(requestLogs)
      .groupBy(requestLogs.projectName)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return { totals, byStatus, byProject };
  }

  // 状态归类:ok→success,timeout→timeout,其余→failed(新系统 status 口径)
  private classify(status: string) {
    return {
      success: status === 'ok' ? 1 : 0,
      timeout: status === 'timeout' ? 1 : 0,
      failed: status !== 'ok' && status !== 'timeout' ? 1 : 0,
    };
  }

  // 单次 RPC 完成累加(热路径,per-completion upsert)。仅 RequestLogProcessor 首插时调,保证 exactly-once。
  async recordCompletion(job: RequestLogJob): Promise<void> {
    const statDate = job.createdAt.slice(0, 10); // ISO(UTC)前 10 位 = UTC 日期
    const { success, timeout, failed } = this.classify(job.status);
    const latency = job.latencyMs ?? 0;
    const clientId = job.clientId ?? '';

    await this.db
      .insert(rpcDailyMetrics)
      .values({
        statDate,
        projectName: job.project,
        actionName: job.action,
        clientId,
        totalRequests: 1,
        successRequests: success,
        failedRequests: failed,
        timeoutRequests: timeout,
        totalLatencyMs: latency,
        maxLatencyMs: latency,
      })
      .onConflictDoUpdate({
        target: [
          rpcDailyMetrics.statDate,
          rpcDailyMetrics.projectName,
          rpcDailyMetrics.actionName,
          rpcDailyMetrics.clientId,
        ],
        set: {
          totalRequests: sql`${rpcDailyMetrics.totalRequests} + 1`,
          successRequests: sql`${rpcDailyMetrics.successRequests} + ${success}`,
          failedRequests: sql`${rpcDailyMetrics.failedRequests} + ${failed}`,
          timeoutRequests: sql`${rpcDailyMetrics.timeoutRequests} + ${timeout}`,
          totalLatencyMs: sql`${rpcDailyMetrics.totalLatencyMs} + ${latency}`,
          maxLatencyMs: sql`GREATEST(${rpcDailyMetrics.maxLatencyMs}, ${latency})`,
          updatedAt: new Date(),
        },
      });

    // device 维度只在有真实 client 时累加(无 client 不进 device_daily)
    if (job.clientId) {
      await this.db
        .insert(deviceDailyMetrics)
        .values({
          statDate,
          clientId: job.clientId,
          projectName: job.project,
          totalRequests: 1,
          successRequests: success,
          failedRequests: failed,
          timeoutRequests: timeout,
          totalLatencyMs: latency,
          maxLatencyMs: latency,
        })
        .onConflictDoUpdate({
          target: [
            deviceDailyMetrics.statDate,
            deviceDailyMetrics.clientId,
            deviceDailyMetrics.projectName,
          ],
          set: {
            totalRequests: sql`${deviceDailyMetrics.totalRequests} + 1`,
            successRequests: sql`${deviceDailyMetrics.successRequests} + ${success}`,
            failedRequests: sql`${deviceDailyMetrics.failedRequests} + ${failed}`,
            timeoutRequests: sql`${deviceDailyMetrics.timeoutRequests} + ${timeout}`,
            totalLatencyMs: sql`${deviceDailyMetrics.totalLatencyMs} + ${latency}`,
            maxLatencyMs: sql`GREATEST(${deviceDailyMetrics.maxLatencyMs}, ${latency})`,
            updatedAt: new Date(),
          },
        });
    }
  }
}
