import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateDeviceAppAudit } from '../../common/app-audit/app-audit.schema';
import type { AppAudit } from '../../common/app-audit/app-audit.types';
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
  // 调用方自带的业务单号,只落日志供检索;路由与去重仍只用内部生成的 requestId
  clientRequestId?: string;
  // 公开 invoke 记录 access token，管理控制台手动调试记录后台用户。
  accessTokenId?: number;
  requesterUserId?: number;
}

// 手机端回传的 result 形状
interface DeviceResult {
  clientId?: string;
  status?: string;
  is_ok?: boolean;
  httpCode?: number;
  payload?: unknown;
  error?: string;
  appAudit?: unknown;
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
    private readonly projectsService: ProjectsService,
    private readonly presenceService: PresenceService,
    private readonly connectionRegistry: ConnectionRegistry,
    private readonly queueService: QueueService,
    private readonly requestLogs: RequestLogsService,
  ) {}

  // RPC invoke 热路径(可分布式):project 名→project id -> 选设备 -> 注册 waiter -> 跨实例下发 job -> 等 result / 超时 -> 入队日志
  async invoke(input: InvokeParams): Promise<InvokeResponse> {
    const requestId = randomUUID();
    const timeoutSeconds = input.timeoutSeconds ?? 20;
    const timeoutMilliseconds = timeoutSeconds * 1000;
    const startedAt = Date.now();

    const projectResolution = await this.resolveProject(
      input,
      requestId,
      startedAt,
    );
    if (typeof projectResolution !== 'number') {
      return projectResolution;
    }

    const deviceSelection = await this.selectDevice(
      input,
      requestId,
      projectResolution,
      startedAt,
    );
    if (typeof deviceSelection !== 'string') {
      return deviceSelection;
    }

    try {
      return await this.dispatchAndAwaitResult(
        input,
        requestId,
        deviceSelection,
        startedAt,
        timeoutSeconds,
        timeoutMilliseconds,
      );
    } finally {
      // 每次 acquire 精确配对一次 release(error/unavailable/success/timeout 全覆盖)
      await this.presenceService
        .releaseSlot(deviceSelection)
        .catch(() => undefined);
    }
  }

  private async resolveProject(
    input: InvokeParams,
    requestId: string,
    startedAt: number,
  ): Promise<number | InvokeResponse> {
    // project 名 -> {id, enabled}(DB 查询;不存在 404、禁用 403,均不算基础设施异常)
    let project: { id: number; enabled: boolean } | null;
    try {
      project = await this.projectsService.findEnabledIdByName(input.project);
    } catch (error) {
      this.logger.error(
        `功能组解析失败(基础设施异常): ${(error as Error).message}`,
      );
      return this.fail(
        input,
        requestId,
        null,
        startedAt,
        'error',
        503,
        '基础设施异常,无法调度',
      );
    }
    if (!project) {
      return this.fail(
        input,
        requestId,
        null,
        startedAt,
        'no_project',
        404,
        '功能组不存在',
      );
    }
    if (!project.enabled) {
      return this.fail(
        input,
        requestId,
        null,
        startedAt,
        'disabled',
        403,
        '功能组已停用',
      );
    }
    return project.id;
  }

  private async selectDevice(
    input: InvokeParams,
    requestId: string,
    projectId: number,
    startedAt: number,
  ): Promise<string | InvokeResponse> {
    // 选目标设备 + 占在途槽(合一步,边挑边占):
    //  - 指定 clientId:校验在线 → 占其槽,满则 rejected;
    //  - 未指定:组内 RR 轮询挑第一个未满设备并占槽,全满才 rejected(组饱和)。
    try {
      if (input.clientId) {
        return await this.acquireRequestedDevice(
          input,
          requestId,
          input.clientId,
          startedAt,
        );
      }
      return await this.acquireAvailableDevice(
        input,
        requestId,
        projectId,
        startedAt,
      );
    } catch (error) {
      this.logger.error(
        `设备选择/占槽失败(基础设施异常): ${(error as Error).message}`,
      );
      return this.fail(
        input,
        requestId,
        input.clientId ?? null,
        startedAt,
        'error',
        503,
        '基础设施异常,无法调度',
      );
    }
  }

  private async acquireRequestedDevice(
    input: InvokeParams,
    requestId: string,
    clientId: string,
    startedAt: number,
  ): Promise<string | InvokeResponse> {
    const isOnline = await this.presenceService.isOnline(clientId);
    if (!isOnline) {
      return this.fail(
        input,
        requestId,
        clientId,
        startedAt,
        'offline',
        503,
        '指定设备不在线',
      );
    }
    const maximumInFlight = await this.presenceService.getMaxInFlight(clientId);
    const acquired = await this.presenceService.tryAcquireSlot(
      clientId,
      maximumInFlight,
    );
    if (!acquired) {
      return this.fail(
        input,
        requestId,
        clientId,
        startedAt,
        'rejected',
        429,
        '设备在途任务已满',
      );
    }
    return clientId;
  }

  private async acquireAvailableDevice(
    input: InvokeParams,
    requestId: string,
    projectId: number,
    startedAt: number,
  ): Promise<string | InvokeResponse> {
    const selection = await this.presenceService.pickOnlineAcquire(projectId);
    if (selection === 'no_device') {
      return this.fail(
        input,
        requestId,
        null,
        startedAt,
        'no_device',
        503,
        '功能组内无在线设备',
      );
    }
    if (selection === 'saturated') {
      return this.fail(
        input,
        requestId,
        null,
        startedAt,
        'rejected',
        429,
        '功能组内设备在途任务均已满',
      );
    }
    return selection.clientId;
  }

  private async dispatchAndAwaitResult(
    input: InvokeParams,
    requestId: string,
    clientId: string,
    startedAt: number,
    timeoutSeconds: number,
    timeoutMilliseconds: number,
  ): Promise<InvokeResponse> {
    const job = {
      type: 'job',
      requestId,
      project: input.project,
      action: input.action,
      payload: input.payload,
      timeoutSeconds,
      deadlineAt: startedAt + timeoutMilliseconds,
    };

    // 先同步注册本地 waiter,再 await 写 redis 等待方标记,最后才 dispatch ——
    // 不依赖 ioredis 的 FIFO 顺序,严格保证 waiter 落地早于 job 被设备处理、result 回流。
    const resultPromise = this.connectionRegistry.registerWaiter<DeviceResult>(
      requestId,
      clientId,
      timeoutMilliseconds,
    );
    // dispatch 失败时 cancelWaiter 会拒绝该 Promise;提前挂处理器避免 unhandled rejection。
    resultPromise.catch(() => undefined);

    const dispatchFailure = await this.dispatchJob(
      input,
      job,
      requestId,
      clientId,
      startedAt,
      timeoutMilliseconds,
    );
    if (dispatchFailure) {
      return dispatchFailure;
    }

    try {
      const result = await resultPromise;
      return this.success(input, requestId, clientId, startedAt, result);
    } catch {
      return this.fail(
        input,
        requestId,
        clientId,
        startedAt,
        'timeout',
        504,
        `超时(${timeoutSeconds}s)`,
      );
    }
  }

  private async dispatchJob(
    input: InvokeParams,
    job: object,
    requestId: string,
    clientId: string,
    startedAt: number,
    timeoutMilliseconds: number,
  ): Promise<InvokeResponse | null> {
    let dispatched: boolean;
    try {
      await this.connectionRegistry.markWaiting(requestId, timeoutMilliseconds);
      dispatched = await this.connectionRegistry.dispatchJob(clientId, job);
    } catch (error) {
      this.connectionRegistry.cancelWaiter(requestId, 'dispatch_error');
      this.logger.error(
        `job 派发失败(基础设施异常): ${(error as Error).message}`,
      );
      return this.fail(
        input,
        requestId,
        clientId,
        startedAt,
        'error',
        503,
        '基础设施异常,无法调度',
      );
    }
    if (dispatched) {
      return null;
    }
    this.connectionRegistry.cancelWaiter(requestId, 'unavailable');
    return this.fail(
      input,
      requestId,
      clientId,
      startedAt,
      'unavailable',
      503,
      '设备连接已断开',
    );
  }

  private success(
    input: InvokeParams,
    requestId: string,
    clientId: string,
    startedAt: number,
    result: DeviceResult,
  ): InvokeResponse {
    const isSuccessful = result.is_ok ?? result.status === 'ok';
    const response: InvokeResponse = {
      requestId,
      clientId,
      is_ok: Boolean(isSuccessful),
      status: this.resultStatus(result.status, isSuccessful),
      httpCode: result.httpCode ?? 200,
      latencyMs: Date.now() - startedAt,
      payload: result.payload,
      error: result.error,
    };
    const appAudit = this.validAppAudit(result.appAudit, requestId);
    void this.enqueueRequestLog(
      input,
      response,
      startedAt,
      result.payload,
      appAudit,
    );
    return response;
  }

  private resultStatus(
    reportedStatus: string | undefined,
    isSuccessful: boolean,
  ): string {
    if (reportedStatus) {
      return reportedStatus;
    }
    return isSuccessful ? 'ok' : 'error';
  }

  private validAppAudit(
    reportedAppAudit: unknown,
    requestId: string,
  ): AppAudit | null {
    if (reportedAppAudit === undefined) {
      return null;
    }
    const validation = validateDeviceAppAudit(reportedAppAudit);
    if (validation.success) {
      return validation.data;
    }
    this.logger.warn(
      `设备 appAudit 已丢弃: requestId=${requestId}, 原因=${validation.reason}`,
    );
    return null;
  }

  private fail(
    input: InvokeParams,
    requestId: string,
    clientId: string | null,
    startedAt: number,
    status: string,
    httpCode: number,
    error: string,
  ): InvokeResponse {
    const response: InvokeResponse = {
      requestId,
      clientId,
      is_ok: false,
      status,
      httpCode,
      latencyMs: Date.now() - startedAt,
      error,
    };
    void this.enqueueRequestLog(input, response, startedAt, null, null);
    return response;
  }

  // 入队请求日志(冷路径)。Redis/BullMQ 不可用时降级同步写 PG 脊柱(task7 补全)。
  private async enqueueRequestLog(
    input: InvokeParams,
    response: InvokeResponse,
    startedAt: number,
    responsePayload: unknown,
    appAudit: AppAudit | null,
  ) {
    const job: RequestLogJob = {
      requestId: response.requestId,
      project: input.project,
      action: input.action,
      clientId: response.clientId,
      clientRequestId: input.clientRequestId ?? null,
      requesterUserId: input.requesterUserId ?? null,
      accessTokenId: input.accessTokenId ?? null,
      status: response.status,
      httpCode: response.httpCode,
      latencyMs: response.latencyMs,
      error: response.error ?? null,
      requestPayload: input.payload,
      responsePayload,
      appAudit,
      createdAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    try {
      // 入队加超时:BullMQ 在 redis 挂时会一直重试而不报错,超时即视为失败走降级
      await Promise.race([
        this.queueService.enqueueRequestLog(job),
        new Promise((unusedResolve, reject) => {
          void unusedResolve;
          setTimeout(() => reject(new Error('enqueue timeout')), 3000);
        }),
      ]);
    } catch (error) {
      // Redis/BullMQ 不可用:降级同步写 PG 脊柱,payload 缺失标 unavailable,保证至少有取证记录
      this.logger.warn(
        `入队请求日志失败,降级同步写 PG 脊柱: ${(error as Error).message}`,
      );
      await this.requestLogs
        .writeSpine(job, 'unavailable')
        .catch((writeError) =>
          this.logger.error(
            `降级写脊柱也失败: ${(writeError as Error).message}`,
          ),
        );
    }
  }
}
