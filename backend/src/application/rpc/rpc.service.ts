import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProjectsService } from '../projects/projects.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { ConnectionRegistry } from '../../infrastructure/ws/connection.registry';
import { PresenceService } from '../../infrastructure/ws/presence.service';
import { RequestLogJob } from '../request-logs/request-log.types';
import { RequestLogsService } from '../request-logs/request-logs.service';

export interface InvokeParams {
  project: string;
  action: string;
  payload: unknown;
  timeoutSeconds?: number;
  clientId?: string;
  // invoke 调用方是 access token(3.4 起不再走用户 JWT),记录 token id 供 request_logs 溯源
  accessTokenId?: number;
}

// 手机端回传的 result 形状
interface DeviceResult {
  clientId?: string;
  status?: string;
  is_ok?: boolean;
  httpCode?: number;
  payload?: unknown;
  error?: string;
}

export interface InvokeResponse {
  requestId: string;
  clientId: string | null;
  is_ok: boolean;
  status: string;
  httpCode: number;
  latencyMs: number;
  payload?: unknown;
  error?: string;
}

@Injectable()
export class RpcService {
  private readonly logger = new Logger('Rpc');
  constructor(
    private readonly projects: ProjectsService,
    private readonly presence: PresenceService,
    private readonly registry: ConnectionRegistry,
    private readonly queue: QueueService,
    private readonly requestLogs: RequestLogsService,
  ) {}

  // RPC invoke 热路径(可分布式):project 名→project id -> 选设备 -> 注册 waiter -> 跨实例下发 job -> 等 result / 超时 -> 入队日志
  async invoke(p: InvokeParams): Promise<InvokeResponse> {
    const requestId = randomUUID();
    const timeoutSeconds = p.timeoutSeconds ?? 20;
    const timeoutMs = timeoutSeconds * 1000;
    const startedAt = Date.now();

    // project 名 -> {id, enabled}(DB 查询;不存在 404、禁用 403,均不算基础设施异常)
    let proj: { id: number; enabled: boolean } | null;
    try {
      proj = await this.projects.findEnabledIdByName(p.project);
    } catch (e) {
      this.logger.error(
        `功能组解析失败(基础设施异常): ${(e as Error).message}`,
      );
      return this.fail(
        p,
        requestId,
        null,
        startedAt,
        'error',
        503,
        '基础设施异常,无法调度',
      );
    }
    if (!proj) {
      return this.fail(
        p,
        requestId,
        null,
        startedAt,
        'no_project',
        404,
        '功能组不存在',
      );
    }
    if (!proj.enabled) {
      return this.fail(
        p,
        requestId,
        null,
        startedAt,
        'disabled',
        403,
        '功能组已停用',
      );
    }
    const projectId = proj.id;

    // 选目标设备 + 占在途槽(合一步,边挑边占):
    //  - 指定 clientId:校验在线 → 占其槽,满则 rejected;
    //  - 未指定:组内 RR 轮询挑第一个未满设备并占槽,全满才 rejected(组饱和)。
    // 到达下面 dispatch try 时槽必已占(由 finally releaseSlot 释放);占槽成功到出 try 之间无 await,
    // catch 不会泄漏已占的槽。基础设施(redis)异常也要留取证脊柱。
    let clientId = p.clientId ?? null;
    try {
      if (clientId) {
        if (!(await this.presence.isOnline(clientId))) {
          return this.fail(
            p,
            requestId,
            clientId,
            startedAt,
            'offline',
            503,
            '指定设备不在线',
          );
        }
        const maxInFlight = await this.presence.getMaxInFlight(clientId);
        if (!(await this.presence.tryAcquireSlot(clientId, maxInFlight))) {
          return this.fail(
            p,
            requestId,
            clientId,
            startedAt,
            'rejected',
            429,
            '设备在途任务已满',
          );
        }
      } else {
        const picked = await this.presence.pickOnlineAcquire(projectId);
        if (picked === 'no_device') {
          return this.fail(
            p,
            requestId,
            null,
            startedAt,
            'no_device',
            503,
            '功能组内无在线设备',
          );
        }
        if (picked === 'saturated') {
          return this.fail(
            p,
            requestId,
            null,
            startedAt,
            'rejected',
            429,
            '功能组内设备在途任务均已满',
          );
        }
        clientId = picked.clientId;
      }
    } catch (e) {
      this.logger.error(
        `设备选择/占槽失败(基础设施异常): ${(e as Error).message}`,
      );
      return this.fail(
        p,
        requestId,
        clientId,
        startedAt,
        'error',
        503,
        '基础设施异常,无法调度',
      );
    }
    try {
      const job = {
        type: 'job',
        requestId,
        project: p.project,
        action: p.action,
        payload: p.payload,
        timeoutSeconds,
        deadlineAt: startedAt + timeoutMs, // startedAt/timeoutMs 已在 invoke 作用域
      };

      // 先同步注册本地 waiter,再 await 写 redis 等待方标记,最后才 dispatch ——
      // 不依赖 ioredis 的 FIFO 顺序,严格保证 waiter 落地早于 job 被设备处理、result 回流。
      // dispatch 失败/异常分支下面会 cancelWaiter 直接 reject 而不 await 它,这里挂个空 catch
      // 防止那种情况下产生 unhandled rejection 把进程带崩(redis 故障绝不能挂死进程)。
      const resultP = this.registry.registerWaiter<DeviceResult>(
        requestId,
        clientId,
        timeoutMs,
      );
      resultP.catch(() => {});

      let dispatched: boolean;
      try {
        // markWaiting 必须 await 完再 dispatch,不依赖 ioredis 的 FIFO 顺序
        await this.registry.markWaiting(requestId, timeoutMs);
        dispatched = await this.registry.dispatchJob(clientId, job);
      } catch (e) {
        this.registry.cancelWaiter(requestId, 'dispatch_error');
        this.logger.error(
          `job 派发失败(基础设施异常): ${(e as Error).message}`,
        );
        return this.fail(
          p,
          requestId,
          clientId,
          startedAt,
          'error',
          503,
          '基础设施异常,无法调度',
        );
      }
      if (!dispatched) {
        this.registry.cancelWaiter(requestId, 'unavailable');
        return this.fail(
          p,
          requestId,
          clientId,
          startedAt,
          'unavailable',
          503,
          '设备连接已断开',
        );
      }

      try {
        const result = await resultP;
        const isOk = result.is_ok ?? result.status === 'ok';
        const resp: InvokeResponse = {
          requestId,
          clientId,
          is_ok: !!isOk,
          status: result.status ?? (isOk ? 'ok' : 'error'),
          httpCode: result.httpCode ?? 200,
          latencyMs: Date.now() - startedAt,
          payload: result.payload,
          error: result.error,
        };
        void this.enqueueLog(p, resp, startedAt, result.payload);
        return resp;
      } catch {
        return this.fail(
          p,
          requestId,
          clientId,
          startedAt,
          'timeout',
          504,
          `超时(${timeoutSeconds}s)`,
        );
      }
    } finally {
      // 每次 acquire 精确配对一次 release(error/unavailable/success/timeout 全覆盖)
      await this.presence.releaseSlot(clientId).catch(() => undefined);
    }
  }

  private fail(
    p: InvokeParams,
    requestId: string,
    clientId: string | null,
    startedAt: number,
    status: string,
    httpCode: number,
    error: string,
  ): InvokeResponse {
    const resp: InvokeResponse = {
      requestId,
      clientId,
      is_ok: false,
      status,
      httpCode,
      latencyMs: Date.now() - startedAt,
      error,
    };
    void this.enqueueLog(p, resp, startedAt, null);
    return resp;
  }

  // 入队请求日志(冷路径)。Redis/BullMQ 不可用时降级同步写 PG 脊柱(task7 补全)。
  private async enqueueLog(
    p: InvokeParams,
    resp: InvokeResponse,
    startedAt: number,
    responsePayload: unknown,
  ) {
    const job: RequestLogJob = {
      requestId: resp.requestId,
      project: p.project,
      action: p.action,
      clientId: resp.clientId,
      requesterUserId: null,
      accessTokenId: p.accessTokenId ?? null,
      status: resp.status,
      httpCode: resp.httpCode,
      latencyMs: resp.latencyMs,
      error: resp.error ?? null,
      requestPayload: p.payload,
      responsePayload,
      createdAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    try {
      // 入队加超时:BullMQ 在 redis 挂时会一直重试而不报错,超时即视为失败走降级
      await Promise.race([
        this.queue.enqueueRequestLog(job),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('enqueue timeout')), 3000),
        ),
      ]);
    } catch (e) {
      // Redis/BullMQ 不可用:降级同步写 PG 脊柱,payload 缺失标 unavailable,保证至少有取证记录
      this.logger.warn(
        `入队请求日志失败,降级同步写 PG 脊柱: ${(e as Error).message}`,
      );
      await this.requestLogs
        .writeSpine(job, 'unavailable')
        .catch((err) =>
          this.logger.error(`降级写脊柱也失败: ${(err as Error).message}`),
        );
    }
  }
}
