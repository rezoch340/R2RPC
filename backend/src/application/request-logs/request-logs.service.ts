import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lt, lte, SQL, sql } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { pageBounds } from '../../common/db/page-bounds';
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
  accessTokenId?: number;
  status?: string;
  payloadState?: string;
  minimumLatencyMs?: number;
  maximumLatencyMs?: number;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

function accessTokenIdConditions(accessTokenId?: number): SQL[] {
  if (accessTokenId === undefined) {
    return [];
  }
  return [eq(requestLogs.accessTokenId, accessTokenId)];
}

// 只存标量字段;list/detail 走 PG 脊柱,payload 原文在 Manticore。
const REQUEST_LOG_SPINE_COLUMNS = {
  id: requestLogs.id,
  requestId: requestLogs.requestId,
  projectName: requestLogs.projectName,
  actionName: requestLogs.actionName,
  clientId: requestLogs.clientId,
  // 调用方身份是取证脊柱的一部分:落库时已写入,OpenAPI 也声明了,必须一并选出来返回
  accessTokenId: requestLogs.accessTokenId,
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
  private get database() {
    return this.dbService.database;
  }

  // 写请求日志脊柱(幂等:request_id 冲突不重复插)。返回是否首插(true = 本次真的插了)。
  async writeSpine(
    job: RequestLogJob,
    payloadState: PayloadState,
  ): Promise<boolean> {
    const insertResult = await this.database
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
    return (insertResult.rowCount ?? 0) > 0;
  }

  async markState(requestId: string, state: PayloadState) {
    await this.database
      .update(requestLogs)
      .set({ payloadState: state })
      .where(eq(requestLogs.requestId, requestId));
  }

  // 监控列表:查脊柱,不返 payload,支持过滤 + 分页
  async list(filter: ListFilter) {
    const conditions = this.buildListConditions(filter);
    const whereClause = conditions.length ? and(...conditions) : undefined;
    const { page, pageSize, offset } = pageBounds(filter);
    const requestRecords = await this.database
      .select(REQUEST_LOG_SPINE_COLUMNS)
      .from(requestLogs)
      .where(whereClause)
      .orderBy(desc(requestLogs.createdAt))
      .limit(pageSize)
      .offset(offset);
    const [{ total }] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(requestLogs)
      .where(whereClause);
    return { rows: requestRecords, page, pageSize, total };
  }

  private buildListConditions(filter: ListFilter): SQL[] {
    const conditions: SQL[] = [];
    if (filter.project) {
      conditions.push(eq(requestLogs.projectName, filter.project));
    }
    if (filter.action) {
      conditions.push(eq(requestLogs.actionName, filter.action));
    }
    if (filter.clientId) {
      conditions.push(eq(requestLogs.clientId, filter.clientId));
    }
    conditions.push(...accessTokenIdConditions(filter.accessTokenId));
    if (filter.status) {
      conditions.push(eq(requestLogs.status, filter.status));
    }
    if (filter.payloadState) {
      conditions.push(eq(requestLogs.payloadState, filter.payloadState));
    }
    if (filter.minimumLatencyMs !== undefined) {
      conditions.push(gte(requestLogs.latencyMs, filter.minimumLatencyMs));
    }
    if (filter.maximumLatencyMs !== undefined) {
      conditions.push(lte(requestLogs.latencyMs, filter.maximumLatencyMs));
    }
    if (filter.from) {
      conditions.push(gte(requestLogs.createdAt, filter.from));
    }
    if (filter.to) {
      conditions.push(lte(requestLogs.createdAt, filter.to));
    }
    return conditions;
  }

  // 监控筛选下拉选项:从 request_logs 去重取 project/action/client 三类候选,供 UI 下拉。
  // 联动过滤:每一维**排除自身**、按其余已选维约束(选了 project 后 action/client 只回该组下出现过的)。
  // 实体存在要求(对齐老系统):project 须在 projects(alive)、client 须在 devices(alive);action 无实体不约束。
  // 每类封顶 200(下拉够用),超出截断。
  async filterOptions(filter: {
    project?: string;
    action?: string;
    clientId?: string;
  }) {
    const maximumOptions = 200;

    // projects:按 action/client 联动,inner join projects(alive)要求分组仍存在
    const projectConditions: SQL[] = [];
    if (filter.action) {
      projectConditions.push(eq(requestLogs.actionName, filter.action));
    }
    if (filter.clientId) {
      projectConditions.push(eq(requestLogs.clientId, filter.clientId));
    }
    const projectRows = await this.database
      .selectDistinct({ name: requestLogs.projectName })
      .from(requestLogs)
      .innerJoin(
        projects,
        alive(projects, eq(projects.name, requestLogs.projectName)),
      )
      .where(projectConditions.length ? and(...projectConditions) : undefined)
      .orderBy(requestLogs.projectName)
      .limit(maximumOptions);

    // actions:按 project/client 联动(action 无实体,不 join)
    const actionConditions: SQL[] = [];
    if (filter.project) {
      actionConditions.push(eq(requestLogs.projectName, filter.project));
    }
    if (filter.clientId) {
      actionConditions.push(eq(requestLogs.clientId, filter.clientId));
    }
    const actionRows = await this.database
      .selectDistinct({ name: requestLogs.actionName })
      .from(requestLogs)
      .where(actionConditions.length ? and(...actionConditions) : undefined)
      .orderBy(requestLogs.actionName)
      .limit(maximumOptions);

    // clientIds:按 project/action 联动,inner join devices(alive)要求设备仍存在;排除 client_id 为空的行
    const clientConditions: SQL[] = [isNotNull(requestLogs.clientId)];
    if (filter.project) {
      clientConditions.push(eq(requestLogs.projectName, filter.project));
    }
    if (filter.action) {
      clientConditions.push(eq(requestLogs.actionName, filter.action));
    }
    const clientRows = await this.database
      .selectDistinct({ clientId: requestLogs.clientId })
      .from(requestLogs)
      .innerJoin(
        devices,
        alive(devices, eq(devices.clientId, requestLogs.clientId)),
      )
      .where(and(...clientConditions))
      .orderBy(requestLogs.clientId)
      .limit(maximumOptions);

    return {
      projects: projectRows.map((projectRecord) => projectRecord.name),
      actions: actionRows.map((actionRecord) => actionRecord.name),
      clientIds: clientRows
        .map((clientRecord) => clientRecord.clientId)
        .filter((clientId): clientId is string => !!clientId),
    };
  }

  async detailSpine(requestId: string) {
    const [requestRecord] = await this.database
      .select(REQUEST_LOG_SPINE_COLUMNS)
      .from(requestLogs)
      .where(eq(requestLogs.requestId, requestId))
      .limit(1);
    return requestRecord ?? null;
  }

  // 扫描陈旧 pending(worker 崩溃遗留),供 repair 标 unavailable
  async findStalePending(minimumAgeMilliseconds: number, limit: number) {
    const cutoffTime = new Date(Date.now() - minimumAgeMilliseconds);
    return this.database
      .select({ requestId: requestLogs.requestId })
      .from(requestLogs)
      .where(
        and(
          eq(requestLogs.payloadState, 'pending'),
          lt(requestLogs.createdAt, cutoffTime),
        ),
      )
      .limit(limit);
  }

  // 按天硬清理:删 created_at 早于 retentionDays 天的日志(log 表不软删)。返回删除条数。
  async cleanupOldRequests(retentionDays: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - retentionDays * 86_400_000);
    const deleteResult = await this.database
      .delete(requestLogs)
      .where(lt(requestLogs.createdAt, cutoffTime));
    return deleteResult.rowCount ?? 0;
  }

  // 按 scope 裁剪:每 (project,action,client) 只留最新 keep 条(created_at DESC, id DESC)。返回删除条数。
  // client_id 为 NULL 的行归为同一 scope("无 client")。
  // ponytail: 全表窗口扫描,每轮维护跑一次;量级大到扛不住再改成只裁剪近期活跃 scope。
  async trimScopes(keep: number): Promise<number> {
    const deleteResult = await this.database.execute(sql`
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
    return deleteResult.rowCount ?? 0;
  }
}
