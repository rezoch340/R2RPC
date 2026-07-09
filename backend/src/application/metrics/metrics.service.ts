import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { RequestLogJob } from '../request-logs/request-log.types';
import { requestLogs } from '../request-logs/request-logs.schema';
import { deviceDailyMetrics, rpcDailyMetrics } from './metrics.schema';

// 指标聚合:完成时增量累加进日聚合表(recordCompletion)+ 启动对账(rebuildRecent)+ 按天清理。
// 查询时聚合(overview)暂留;读侧派生视图(weekly/trend)见 3b。
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

  // 今天(UTC)往前 n 天的日期串 'YYYY-MM-DD'
  private utcDateNDaysAgo(n: number): string {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n),
    )
      .toISOString()
      .slice(0, 10);
  }

  // 近7天设备指标:按 (clientId, project) 汇总 device_daily_metrics(可选 project 过滤)
  async weekly(project?: string) {
    const cutoffDate = this.utcDateNDaysAgo(6); // 含今天共 7 天
    const conds = [gte(deviceDailyMetrics.statDate, cutoffDate)];
    if (project) conds.push(eq(deviceDailyMetrics.projectName, project));
    return this.db
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
      .where(and(...conds))
      .groupBy(deviceDailyMetrics.clientId, deviceDailyMetrics.projectName)
      .orderBy(desc(sql`sum(${deviceDailyMetrics.totalRequests})`));
  }

  // 按天趋势:近 days 天 rpc_daily_metrics 汇总,JS 生成 UTC 日期序列补零(缺的天填 0)
  async trend(days: number, project?: string) {
    const cutoffDate = this.utcDateNDaysAgo(days - 1);
    const conds = [gte(rpcDailyMetrics.statDate, cutoffDate)];
    if (project) conds.push(eq(rpcDailyMetrics.projectName, project));
    const rows = await this.db
      .select({
        statDate: rpcDailyMetrics.statDate,
        total: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        success: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
        failed: sql<number>`sum(${rpcDailyMetrics.failedRequests})::int`,
        timeout: sql<number>`sum(${rpcDailyMetrics.timeoutRequests})::int`,
        totalLat: sql<number>`sum(${rpcDailyMetrics.totalLatencyMs})::bigint`,
        maxLat: sql<number>`coalesce(max(${rpcDailyMetrics.maxLatencyMs}), 0)::int`,
      })
      .from(rpcDailyMetrics)
      .where(and(...conds))
      .groupBy(rpcDailyMetrics.statDate);
    const byDate = new Map(rows.map((r) => [String(r.statDate), r]));
    const points: {
      statDate: string;
      totalRequests: number;
      successRequests: number;
      failedRequests: number;
      timeoutRequests: number;
      avgLatencyMs: number;
      maxLatencyMs: number;
      successRate: number;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = this.utcDateNDaysAgo(i);
      const r = byDate.get(d);
      const total = Number(r?.total ?? 0);
      const success = Number(r?.success ?? 0);
      points.push({
        statDate: d,
        totalRequests: total,
        successRequests: success,
        failedRequests: Number(r?.failed ?? 0),
        timeoutRequests: Number(r?.timeout ?? 0),
        avgLatencyMs: total ? Math.round(Number(r?.totalLat ?? 0) / total) : 0,
        maxLatencyMs: Number(r?.maxLat ?? 0),
        successRate: total ? Math.round((success * 10000) / total) / 100 : 0,
      });
    }
    return points;
  }

  // 近7天每 project 的请求/成功数(供 GroupInfo)。返回 project_name -> {requests7d, success7d}
  async requests7dByProject() {
    const cutoffDate = this.utcDateNDaysAgo(6);
    const rows = await this.db
      .select({
        project: rpcDailyMetrics.projectName,
        requests7d: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        success7d: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
      })
      .from(rpcDailyMetrics)
      .where(gte(rpcDailyMetrics.statDate, cutoffDate))
      .groupBy(rpcDailyMetrics.projectName);
    return new Map(rows.map((r) => [r.project, r]));
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

    // rpc + device 两个 upsert 放同一事务:避免 rpc 已提交而 device 抛错时(重试因 writeSpine 首插判被跳过)两表长期不一致
    await this.db.transaction(async (tx) => {
      await tx
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
        await tx
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
    });
  }

  // 重启对账:重灌最近 days 个"整天"(UTC)的聚合行(修增量丢/重)。
  // cutoff 取 今天-(days-1) 的 UTC 零点,让 DELETE(按 stat_date 整天)与 INSERT(按 created_at)覆盖同一整天区间;
  // 更老的边界日(raw 已按天清掉早半天)不动,保留其增量完整值,避免被半天 raw 重灌成欠计。
  async rebuildRecent(days: number): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (days - 1),
      ),
    );
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(rpcDailyMetrics)
        .where(gte(rpcDailyMetrics.statDate, cutoffDate));
      await tx
        .delete(deviceDailyMetrics)
        .where(gte(deviceDailyMetrics.statDate, cutoffDate));
      await tx.execute(sql`
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
        WHERE created_at >= ${cutoff}
        GROUP BY 1, project_name, action_name, COALESCE(client_id, '')
      `);
      await tx.execute(sql`
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
        WHERE created_at >= ${cutoff} AND client_id IS NOT NULL
        GROUP BY 1, client_id, project_name
      `);
    });
  }

  // 按天清理:删 stat_date 早于 今天-(retentionDays-1) 的聚合行。返回删除条数。
  async cleanupOldMetrics(
    retentionDays: number,
  ): Promise<{ rpc: number; device: number }> {
    const cutoff = new Date(Date.now() - (retentionDays - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const r = await this.db
      .delete(rpcDailyMetrics)
      .where(lt(rpcDailyMetrics.statDate, cutoff));
    const d = await this.db
      .delete(deviceDailyMetrics)
      .where(lt(deviceDailyMetrics.statDate, cutoff));
    return { rpc: r.rowCount ?? 0, device: d.rowCount ?? 0 };
  }
}
