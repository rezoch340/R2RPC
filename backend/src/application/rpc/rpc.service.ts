import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { ConnectionRegistry } from '../../infrastructure/ws/connection.registry';
import { PresenceService } from '../../infrastructure/ws/presence.service';
import { RequestLogJob } from '../request-logs/request-log.types';
import { RequestLogsService } from '../request-logs/request-logs.service';

export interface InvokeParams {
  group: string;
  action: string;
  payload: unknown;
  timeoutSeconds?: number;
  clientId?: string;
  requesterUserId?: number | string;
}

// 手机端回传的 result 形状
interface DeviceResult {
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
    private readonly presence: PresenceService,
    private readonly registry: ConnectionRegistry,
    private readonly queue: QueueService,
    private readonly requestLogs: RequestLogsService,
  ) {}

  // RPC invoke 热路径:选设备 -> 下发 job -> 等 result / 超时 -> 入队日志 -> 返回 is_ok
  async invoke(p: InvokeParams): Promise<InvokeResponse> {
    const requestId = randomUUID();
    const timeoutSeconds = p.timeoutSeconds ?? 20;
    const startedAt = Date.now();

    // 选目标设备:指定 clientId 优先,否则组内轮询。基础设施(redis)异常也要留取证脊柱。
    let clientId = p.clientId ?? null;
    try {
      if (clientId) {
        if (!(await this.presence.isOnline(clientId))) {
          return this.fail(p, requestId, clientId, startedAt, 'offline', 503, '指定设备不在线');
        }
      } else {
        clientId = await this.presence.pickOnline(p.group);
        if (!clientId) {
          return this.fail(p, requestId, null, startedAt, 'no_device', 503, 'group 内无在线设备');
        }
      }
    } catch (e) {
      // redis 不可用等:enqueueLog 会降级同步写 PG 脊柱(payload_state=unavailable)
      this.logger.error(`设备选择失败(基础设施异常): ${(e as Error).message}`);
      return this.fail(p, requestId, clientId, startedAt, 'error', 503, '基础设施异常,无法调度');
    }

    const job = {
      type: 'job',
      requestId,
      group: p.group,
      action: p.action,
      payload: p.payload,
      timeoutSeconds,
    };
    if (!this.registry.sendJob(clientId, job)) {
      // 设备在线(redis)但 socket 不在本实例(多实例场景待接 pub/sub)
      return this.fail(p, requestId, clientId, startedAt, 'unavailable', 503, '设备连接不在本实例');
    }

    try {
      const result = await this.registry.waitForResult<DeviceResult>(
        requestId,
        clientId,
        timeoutSeconds * 1000,
      );
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
      return this.fail(p, requestId, clientId, startedAt, 'timeout', 504, `超时(${timeoutSeconds}s)`);
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
      group: p.group,
      action: p.action,
      clientId: resp.clientId,
      requesterUserId: p.requesterUserId ?? null,
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
      this.logger.warn(`入队请求日志失败,降级同步写 PG 脊柱: ${(e as Error).message}`);
      await this.requestLogs
        .writeSpine(job, 'unavailable')
        .catch((err) => this.logger.error(`降级写脊柱也失败: ${(err as Error).message}`));
    }
  }
}
