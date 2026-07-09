import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lt, lte, SQL, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { alive } from '../../common/db/soft-delete';
import { devices } from '../devices/devices.schema';
import { projects } from '../projects/projects.schema';
import { RequestLogJob } from './request-log.types';
import { requestLogs } from './request-logs.schema';

export type PayloadState = 'pending' | 'indexed' | 'failed' | 'unavailable';

export interface ListFilter {
  project?: string;
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
  projectName: requestLogs.projectName,
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

  // 写请求日志脊柱(幂等:request_id 冲突不重复插)。返回是否首插(true = 本次真的插了)。
  async writeSpine(
    job: RequestLogJob,
    payloadState: PayloadState,
  ): Promise<boolean> {
    const res = await this.db
      .insert(requestLogs)
      .values({
        requestId: job.requestId,
        projectName: job.project,
        actionName: job.action,
        clientId: job.clientId ?? null,
        requesterUserId:
          typeof job.requesterUserId === 'number' ? job.requesterUserId : null,
        accessTokenId: job.accessTokenId ?? null,
        status: job.status,
        httpCode: job.httpCode ?? null,
        latencyMs: job.latencyMs ?? null,
        errorMessage: job.error ?? null,
        payloadState,
        createdAt: job.createdAt ? new Date(job.createdAt) : new Date(),
        finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
      })
      .onConflictDoNothing({ target: requestLogs.requestId });
    return (res.rowCount ?? 0) > 0;
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
    if (f.project) conds.push(eq(requestLogs.projectName, f.project));
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

  // 监控筛选下拉选项:从 request_logs 去重取 project/action/client 三类候选,供 UI 下拉。
  // 联动过滤:每一维**排除自身**、按其余已选维约束(选了 project 后 action/client 只回该组下出现过的)。
  // 实体存在要求(对齐老系统):project 须在 projects(alive)、client 须在 devices(alive);action 无实体不约束。
  // 每类封顶 200(下拉够用),超出截断。
  async filterOptions(f: {
    project?: string;
    action?: string;
    clientId?: string;
  }) {
    const LIMIT = 200;

    // projects:按 action/client 联动,inner join projects(alive)要求分组仍存在
    const projConds: SQL[] = [];
    if (f.action) projConds.push(eq(requestLogs.actionName, f.action));
    if (f.clientId) projConds.push(eq(requestLogs.clientId, f.clientId));
    const projectRows = await this.db
      .selectDistinct({ name: requestLogs.projectName })
      .from(requestLogs)
      .innerJoin(
        projects,
        alive(projects, eq(projects.name, requestLogs.projectName)),
      )
      .where(projConds.length ? and(...projConds) : undefined)
      .orderBy(requestLogs.projectName)
      .limit(LIMIT);

    // actions:按 project/client 联动(action 无实体,不 join)
    const actConds: SQL[] = [];
    if (f.project) actConds.push(eq(requestLogs.projectName, f.project));
    if (f.clientId) actConds.push(eq(requestLogs.clientId, f.clientId));
    const actionRows = await this.db
      .selectDistinct({ name: requestLogs.actionName })
      .from(requestLogs)
      .where(actConds.length ? and(...actConds) : undefined)
      .orderBy(requestLogs.actionName)
      .limit(LIMIT);

    // clientIds:按 project/action 联动,inner join devices(alive)要求设备仍存在;排除 client_id 为空的行
    const cliConds: SQL[] = [isNotNull(requestLogs.clientId)];
    if (f.project) cliConds.push(eq(requestLogs.projectName, f.project));
    if (f.action) cliConds.push(eq(requestLogs.actionName, f.action));
    const clientRows = await this.db
      .selectDistinct({ clientId: requestLogs.clientId })
      .from(requestLogs)
      .innerJoin(
        devices,
        alive(devices, eq(devices.clientId, requestLogs.clientId)),
      )
      .where(and(...cliConds))
      .orderBy(requestLogs.clientId)
      .limit(LIMIT);

    return {
      projects: projectRows.map((r) => r.name),
      actions: actionRows.map((r) => r.name),
      clientIds: clientRows
        .map((r) => r.clientId)
        .filter((c): c is string => !!c),
    };
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
        and(
          eq(requestLogs.payloadState, 'pending'),
          lt(requestLogs.createdAt, cutoff),
        ),
      )
      .limit(limit);
  }

  // 按天硬清理:删 created_at 早于 retentionDays 天的日志(log 表不软删)。返回删除条数。
  async cleanupOldRequests(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const res = await this.db
      .delete(requestLogs)
      .where(lt(requestLogs.createdAt, cutoff));
    return res.rowCount ?? 0;
  }

  // 按 scope 裁剪:每 (project,action,client) 只留最新 keep 条(created_at DESC, id DESC)。返回删除条数。
  // client_id 为 NULL 的行归为同一 scope("无 client")。
  // ponytail: 全表窗口扫描,每轮维护跑一次;量级大到扛不住再改成只裁剪近期活跃 scope。
  async trimScopes(keep: number): Promise<number> {
    const res = await this.db.execute(sql`
      DELETE FROM ${requestLogs}
      WHERE ${requestLogs.id} IN (
        SELECT id FROM (
          SELECT ${requestLogs.id} AS id, ROW_NUMBER() OVER (
            PARTITION BY ${requestLogs.projectName}, ${requestLogs.actionName}, ${requestLogs.clientId}
            ORDER BY ${requestLogs.createdAt} DESC, ${requestLogs.id} DESC
          ) AS rn
          FROM ${requestLogs}
        ) ranked
        WHERE rn > ${keep}
      )
    `);
    return res.rowCount ?? 0;
  }
}
