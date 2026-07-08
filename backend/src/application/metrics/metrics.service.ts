import { Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { requestLogs } from '../request-logs/request-logs.schema';

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

    const byGroup = await this.db
      .select({
        group: requestLogs.groupName,
        count: sql<number>`count(*)::int`,
      })
      .from(requestLogs)
      .groupBy(requestLogs.groupName)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return { totals, byStatus, byGroup };
  }
}
