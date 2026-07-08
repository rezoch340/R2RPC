import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, SQL, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { RequestLogJob } from './request-log.types';
import { requestLogs } from './request-logs.schema';

export type PayloadState = 'pending' | 'indexed' | 'failed' | 'unavailable';

export interface ListFilter {
  group?: string;
  action?: string;
  clientId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

// 只存标量字段;list/detail 走 PG 脊柱,payload 原文在 Manticore。
const SPINE = {
  id: requestLogs.id,
  requestId: requestLogs.requestId,
  groupName: requestLogs.groupName,
  actionName: requestLogs.actionName,
  clientId: requestLogs.clientId,
  requesterUserId: requestLogs.requesterUserId,
  status: requestLogs.status,
  httpCode: requestLogs.httpCode,
  latencyMs: requestLogs.latencyMs,
  errorMessage: requestLogs.errorMessage,
  payloadState: requestLogs.payloadState,
  createdAt: requestLogs.createdAt,
  finishedAt: requestLogs.finishedAt,
};

@Injectable()
export class RequestLogsService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  // 写请求日志脊柱(幂等:request_id 冲突不重复插)
  async writeSpine(job: RequestLogJob, payloadState: PayloadState) {
    await this.db
      .insert(requestLogs)
      .values({
        requestId: job.requestId,
        groupName: job.group,
        actionName: job.action,
        clientId: job.clientId ?? null,
        requesterUserId:
          typeof job.requesterUserId === 'number' ? job.requesterUserId : null,
        status: job.status,
        httpCode: job.httpCode ?? null,
        latencyMs: job.latencyMs ?? null,
        errorMessage: job.error ?? null,
        payloadState,
        createdAt: job.createdAt ? new Date(job.createdAt) : new Date(),
        finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
      })
      .onConflictDoNothing({ target: requestLogs.requestId });
  }

  async markState(requestId: string, state: PayloadState) {
    await this.db
      .update(requestLogs)
      .set({ payloadState: state })
      .where(eq(requestLogs.requestId, requestId));
  }

  // 监控列表:查脊柱,不返 payload,支持过滤 + 分页
  async list(f: ListFilter) {
    const conds: SQL[] = [];
    if (f.group) conds.push(eq(requestLogs.groupName, f.group));
    if (f.action) conds.push(eq(requestLogs.actionName, f.action));
    if (f.clientId) conds.push(eq(requestLogs.clientId, f.clientId));
    if (f.status) conds.push(eq(requestLogs.status, f.status));
    if (f.from) conds.push(gte(requestLogs.createdAt, f.from));
    if (f.to) conds.push(lte(requestLogs.createdAt, f.to));
    const where = conds.length ? and(...conds) : undefined;
    const page = Math.max(1, f.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 20));
    const rows = await this.db
      .select(SPINE)
      .from(requestLogs)
      .where(where)
      .orderBy(desc(requestLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(requestLogs)
      .where(where);
    return { rows, page, pageSize, total };
  }

  async detailSpine(requestId: string) {
    const [row] = await this.db
      .select(SPINE)
      .from(requestLogs)
      .where(eq(requestLogs.requestId, requestId))
      .limit(1);
    return row ?? null;
  }

  // 扫描陈旧 pending(worker 崩溃遗留),供 repair 标 unavailable
  async findStalePending(minAgeMs: number, limit: number) {
    const cutoff = new Date(Date.now() - minAgeMs);
    return this.db
      .select({ requestId: requestLogs.requestId })
      .from(requestLogs)
      .where(
        and(eq(requestLogs.payloadState, 'pending'), lt(requestLogs.createdAt, cutoff)),
      )
      .limit(limit);
  }
}
