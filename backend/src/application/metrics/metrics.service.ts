import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { RequestLogJob } from '../request-logs/request-log.types';
import { requestLogs } from '../request-logs/request-logs.schema';
import { deviceDailyMetrics, rpcDailyMetrics } from './metrics.schema';

interface DailyTrendAggregate {
  statDate: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  totalLatencyMilliseconds: number;
  maximumLatencyMilliseconds: number;
}

export interface DailyTrendPoint {
  statDate: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  successRate: number;
}

// 指标聚合:完成时增量累加进日聚合表(recordCompletion)+ 启动对账(rebuildRecent)+ 按天清理。
// 查询时聚合(overview)暂留;读侧派生视图(weekly/trend)见 3b。
@Injectable()
export class MetricsService {
  constructor(private readonly dbService: DbService) {}
  private get database() {
    return this.dbService.database;
  }

  async overview() {
    const [totals] = await this.database
      .select({
        total: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${requestLogs.status} = 'ok')::int`,
        failed: sql<number>`count(*) filter (where ${requestLogs.status} <> 'ok')::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)::int`,
      })
      .from(requestLogs);

    const byStatus = await this.database
      .select({ status: requestLogs.status, count: sql<number>`count(*)::int` })
      .from(requestLogs)
      .groupBy(requestLogs.status)
      .orderBy(desc(sql`count(*)`));

    const byProject = await this.database
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

  // 今天(UTC)往前指定天数的日期串 'YYYY-MM-DD'
  private utcDateDaysAgo(daysAgo: number): string {
    const currentTime = new Date();
    return new Date(
      Date.UTC(
        currentTime.getUTCFullYear(),
        currentTime.getUTCMonth(),
        currentTime.getUTCDate() - daysAgo,
      ),
    )
      .toISOString()
      .slice(0, 10);
  }

  // 近7天设备指标:按 (clientId, project) 汇总 device_daily_metrics(可选 project 过滤)
  async weekly(project?: string) {
    const cutoffDate = this.utcDateDaysAgo(6); // 含今天共 7 天
    const conditions = [gte(deviceDailyMetrics.statDate, cutoffDate)];
    if (project) {
      conditions.push(eq(deviceDailyMetrics.projectName, project));
    }
    return this.database
      .select({
        clientId: deviceDailyMetrics.clientId,
        project: deviceDailyMetrics.projectName,
        totalRequests: sql<number>`sum(${deviceDailyMetrics.totalRequests})::int`,
        successRequests: sql<number>`sum(${deviceDailyMetrics.successRequests})::int`,
        failedRequests: sql<number>`sum(${deviceDailyMetrics.failedRequests})::int`,
        timeoutRequests: sql<number>`sum(${deviceDailyMetrics.timeoutRequests})::int`,
        avgLatencyMs: sql<number>`coalesce(round(sum(${deviceDailyMetrics.totalLatencyMs})::numeric / nullif(sum(${deviceDailyMetrics.totalRequests}), 0)), 0)::int`,
        maxLatencyMs: sql<number>`coalesce(max(${deviceDailyMetrics.maxLatencyMs}), 0)::int`,
      })
      .from(deviceDailyMetrics)
      .where(and(...conditions))
      .groupBy(deviceDailyMetrics.clientId, deviceDailyMetrics.projectName)
      .orderBy(desc(sql`sum(${deviceDailyMetrics.totalRequests})`));
  }

  // 按天趋势:近 days 天 rpc_daily_metrics 汇总,JS 生成 UTC 日期序列补零(缺的天填 0)
  async trend(days: number, project?: string) {
    const cutoffDate = this.utcDateDaysAgo(days - 1);
    const conditions = [gte(rpcDailyMetrics.statDate, cutoffDate)];
    if (project) {
      conditions.push(eq(rpcDailyMetrics.projectName, project));
    }
    const aggregateRows = await this.database
      .select({
        statDate: rpcDailyMetrics.statDate,
        totalRequests: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        successRequests: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
        failedRequests: sql<number>`sum(${rpcDailyMetrics.failedRequests})::int`,
        timeoutRequests: sql<number>`sum(${rpcDailyMetrics.timeoutRequests})::int`,
        totalLatencyMilliseconds: sql<number>`sum(${rpcDailyMetrics.totalLatencyMs})::bigint`,
        maximumLatencyMilliseconds: sql<number>`coalesce(max(${rpcDailyMetrics.maxLatencyMs}), 0)::int`,
      })
      .from(rpcDailyMetrics)
      .where(and(...conditions))
      .groupBy(rpcDailyMetrics.statDate);
    const aggregatesByDate = new Map(
      aggregateRows.map((aggregateRow) => [
        String(aggregateRow.statDate),
        aggregateRow,
      ]),
    );
    const trendPoints: DailyTrendPoint[] = [];
    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo -= 1) {
      const statDate = this.utcDateDaysAgo(daysAgo);
      const aggregate = aggregatesByDate.get(statDate);
      trendPoints.push(this.toTrendPoint(statDate, aggregate));
    }
    return trendPoints;
  }

  // 近7天每 project 的请求/成功数(供 GroupInfo)。返回 project_name -> {requests7d, success7d}
  async requests7dByProject() {
    const cutoffDate = this.utcDateDaysAgo(6);
    const projectMetrics = await this.database
      .select({
        project: rpcDailyMetrics.projectName,
        requests7d: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        success7d: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
      })
      .from(rpcDailyMetrics)
      .where(gte(rpcDailyMetrics.statDate, cutoffDate))
      .groupBy(rpcDailyMetrics.projectName);
    return new Map(
      projectMetrics.map((projectMetric) => [
        projectMetric.project,
        projectMetric,
      ]),
    );
  }

  // 状态归类:ok→success,timeout→timeout,其余→failed(新系统 status 口径)
  private classify(status: string) {
    if (status === 'ok') {
      return { success: 1, timeout: 0, failed: 0 };
    }
    if (status === 'timeout') {
      return { success: 0, timeout: 1, failed: 0 };
    }
    return { success: 0, timeout: 0, failed: 1 };
  }

  // 单次 RPC 完成累加(热路径,per-completion upsert)。仅 RequestLogProcessor 首插时调,保证 exactly-once。
  async recordCompletion(job: RequestLogJob): Promise<void> {
    const statDate = job.createdAt.slice(0, 10); // ISO(UTC)前 10 位 = UTC 日期
    const { success, timeout, failed } = this.classify(job.status);
    const latencyMilliseconds = job.latencyMs ?? 0;
    const clientId = job.clientId ?? '';

    // rpc + device 两个 upsert 放同一事务:避免 rpc 已提交而 device 抛错时(重试因 writeSpine 首插判被跳过)两表长期不一致
    await this.database.transaction(async (transaction) => {
      await transaction
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
          totalLatencyMs: latencyMilliseconds,
          maxLatencyMs: latencyMilliseconds,
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
            totalLatencyMs: sql`${rpcDailyMetrics.totalLatencyMs} + ${latencyMilliseconds}`,
            maxLatencyMs: sql`GREATEST(${rpcDailyMetrics.maxLatencyMs}, ${latencyMilliseconds})`,
            updatedAt: new Date(),
          },
        });

      // device 维度只在有真实 client 时累加(无 client 不进 device_daily)
      if (job.clientId) {
        await transaction
          .insert(deviceDailyMetrics)
          .values({
            statDate,
            clientId: job.clientId,
            projectName: job.project,
            totalRequests: 1,
            successRequests: success,
            failedRequests: failed,
            timeoutRequests: timeout,
            totalLatencyMs: latencyMilliseconds,
            maxLatencyMs: latencyMilliseconds,
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
              totalLatencyMs: sql`${deviceDailyMetrics.totalLatencyMs} + ${latencyMilliseconds}`,
              maxLatencyMs: sql`GREATEST(${deviceDailyMetrics.maxLatencyMs}, ${latencyMilliseconds})`,
              updatedAt: new Date(),
            },
          });
      }
    });
  }

  // 重启对账:重灌最近 days 个"整天"(UTC)的聚合行(修增量丢/重)。
  // cutoff 取 今天-(days-1) 的 UTC 零点,让 DELETE(按 stat_date 整天)与 INSERT(按 created_at)覆盖同一整天区间;
  // 更老的边界日(raw 已按天清掉早半天)不动,保留其增量完整值,避免被半天 raw 重灌成欠计。
  async rebuildRecent(days: number): Promise<void> {
    const currentTime = new Date();
    const cutoffTime = new Date(
      Date.UTC(
        currentTime.getUTCFullYear(),
        currentTime.getUTCMonth(),
        currentTime.getUTCDate() - (days - 1),
      ),
    );
    const cutoffDate = cutoffTime.toISOString().slice(0, 10);
    await this.database.transaction(async (transaction) => {
      await transaction
        .delete(rpcDailyMetrics)
        .where(gte(rpcDailyMetrics.statDate, cutoffDate));
      await transaction
        .delete(deviceDailyMetrics)
        .where(gte(deviceDailyMetrics.statDate, cutoffDate));
      await transaction.execute(sql`
        INSERT INTO rpc_daily_metrics
          (stat_date, project_name, action_name, client_id,
           total_requests, success_requests, failed_requests, timeout_requests,
           total_latency_ms, max_latency_ms, updated_at)
        SELECT (created_at AT TIME ZONE 'UTC')::date, project_name, action_name, COALESCE(client_id, ''),
          count(*),
          count(*) FILTER (WHERE status = 'ok'),
          count(*) FILTER (WHERE status <> 'ok' AND status <> 'timeout'),
          count(*) FILTER (WHERE status = 'timeout'),
          COALESCE(sum(latency_ms), 0), COALESCE(max(latency_ms), 0), now()
        FROM request_logs
        WHERE created_at >= ${cutoffTime}
        GROUP BY 1, project_name, action_name, COALESCE(client_id, '')
      `);
      await transaction.execute(sql`
        INSERT INTO device_daily_metrics
          (stat_date, client_id, project_name,
           total_requests, success_requests, failed_requests, timeout_requests,
           total_latency_ms, max_latency_ms, updated_at)
        SELECT (created_at AT TIME ZONE 'UTC')::date, client_id, project_name,
          count(*),
          count(*) FILTER (WHERE status = 'ok'),
          count(*) FILTER (WHERE status <> 'ok' AND status <> 'timeout'),
          count(*) FILTER (WHERE status = 'timeout'),
          COALESCE(sum(latency_ms), 0), COALESCE(max(latency_ms), 0), now()
        FROM request_logs
        WHERE created_at >= ${cutoffTime} AND client_id IS NOT NULL
        GROUP BY 1, client_id, project_name
      `);
    });
  }

  // 按天清理:删 stat_date 早于 今天-(retentionDays-1) 的聚合行。返回删除条数。
  async cleanupOldMetrics(
    retentionDays: number,
  ): Promise<{ rpc: number; device: number }> {
    const cutoffDate = new Date(Date.now() - (retentionDays - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rpcDeleteResult = await this.database
      .delete(rpcDailyMetrics)
      .where(lt(rpcDailyMetrics.statDate, cutoffDate));
    const deviceDeleteResult = await this.database
      .delete(deviceDailyMetrics)
      .where(lt(deviceDailyMetrics.statDate, cutoffDate));
    return {
      rpc: rpcDeleteResult.rowCount ?? 0,
      device: deviceDeleteResult.rowCount ?? 0,
    };
  }

  private toTrendPoint(
    statDate: string,
    aggregate: DailyTrendAggregate | undefined,
  ): DailyTrendPoint {
    if (!aggregate) {
      return {
        statDate,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        timeoutRequests: 0,
        avgLatencyMs: 0,
        maxLatencyMs: 0,
        successRate: 0,
      };
    }
    const totalRequests = Number(aggregate.totalRequests);
    const successRequests = Number(aggregate.successRequests);
    return {
      statDate,
      totalRequests,
      successRequests,
      failedRequests: Number(aggregate.failedRequests),
      timeoutRequests: Number(aggregate.timeoutRequests),
      avgLatencyMs: this.averageLatency(aggregate, totalRequests),
      maxLatencyMs: Number(aggregate.maximumLatencyMilliseconds),
      successRate: this.successRate(successRequests, totalRequests),
    };
  }

  private averageLatency(
    aggregate: DailyTrendAggregate,
    totalRequests: number,
  ): number {
    if (totalRequests === 0) {
      return 0;
    }
    return Math.round(
      Number(aggregate.totalLatencyMilliseconds) / totalRequests,
    );
  }

  private successRate(successRequests: number, totalRequests: number): number {
    if (totalRequests === 0) {
      return 0;
    }
    return Math.round((successRequests * 10_000) / totalRequests) / 100;
  }
}
