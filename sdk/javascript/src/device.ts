import DefaultWebSocket from 'isomorphic-ws';
import {
  Rer0RpcAuthenticationError,
  Rer0RpcError,
} from './errors.js';
import type {
  DeviceActionHandler,
  DeviceActionResult,
  DeviceConnectionEvent,
  DeviceConnectionState,
  JsonValue,
  RpcJob,
} from './types.js';

interface WebSocketMessageEvent {
  data: unknown;
}

interface WebSocketCloseEvent {
  code: number;
  reason: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null;
  onclose: ((event: WebSocketCloseEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface Rer0RpcDeviceOptions {
  baseUrl: string;
  deviceToken: string;
  clientId: string;
  platform?: string;
  extra?: JsonValue;
  maxInFlight?: number;
  heartbeatIntervalMilliseconds?: number;
  reconnectInitialDelayMilliseconds?: number;
  reconnectMaximumDelayMilliseconds?: number;
  webSocketFactory?: WebSocketFactory;
  onStateChange?: (event: DeviceConnectionEvent) => void;
  onError?: (error: Error) => void;
}

const WEB_SOCKET_OPEN_STATE = 1;

export class Rer0RpcDevice {
  private readonly actionHandlers = new Map<string, DeviceActionHandler>();
  private readonly webSocketFactory: WebSocketFactory;
  private connectionState: DeviceConnectionState = 'idle';
  private webSocket: WebSocketLike | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private shouldRun = false;
  private defaultHandler: DeviceActionHandler | undefined;

  constructor(private readonly options: Rer0RpcDeviceOptions) {
    if (!options.baseUrl.trim()) {
      throw new TypeError('baseUrl 不能为空');
    }
    if (!options.deviceToken.trim()) {
      throw new TypeError('deviceToken 不能为空');
    }
    if (!options.clientId.trim()) {
      throw new TypeError('clientId 不能为空');
    }
    ensurePositive(
      'heartbeatIntervalMilliseconds',
      options.heartbeatIntervalMilliseconds,
    );
    ensurePositive(
      'reconnectInitialDelayMilliseconds',
      options.reconnectInitialDelayMilliseconds,
    );
    ensurePositive(
      'reconnectMaximumDelayMilliseconds',
      options.reconnectMaximumDelayMilliseconds,
    );
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => new DefaultWebSocket(url) as unknown as WebSocketLike);
  }

  get state(): DeviceConnectionState {
    return this.connectionState;
  }

  registerAction(action: string, handler: DeviceActionHandler): () => void {
    if (!action.trim()) {
      throw new TypeError('action 不能为空');
    }
    this.actionHandlers.set(action, handler);
    return () => this.actionHandlers.delete(action);
  }

  registerDefaultHandler(handler: DeviceActionHandler): () => void {
    this.defaultHandler = handler;
    return () => {
      if (this.defaultHandler === handler) {
        this.defaultHandler = undefined;
      }
    };
  }

  start(): void {
    if (this.shouldRun) {
      return;
    }
    this.shouldRun = true;
    this.reconnectAttempt = 0;
    this.openConnection('connecting');
  }

  stop(): void {
    this.shouldRun = false;
    this.clearTimers();
    this.webSocket?.close(1000, 'client stopped');
    this.webSocket = undefined;
    this.setState('stopped');
  }

  private openConnection(state: DeviceConnectionState): void {
    this.setState(state);
    const webSocket = this.webSocketFactory(this.buildWebSocketUrl());
    this.webSocket = webSocket;
    webSocket.onopen = () => undefined;
    webSocket.onmessage = (event) =>
      this.handleMessage(webSocket, event.data);
    webSocket.onerror = () =>
      this.reportError(new Rer0RpcError('设备 WebSocket 连接错误'));
    webSocket.onclose = (event) => this.handleClose(webSocket, event);
  }

  private buildWebSocketUrl(): string {
    const webSocketUrl = new URL('/api/client/ws', this.options.baseUrl);
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    webSocketUrl.searchParams.set('token', this.options.deviceToken);
    webSocketUrl.searchParams.set('clientId', this.options.clientId);
    if (this.options.platform) {
      webSocketUrl.searchParams.set('platform', this.options.platform);
    }
    if (this.options.extra !== undefined) {
      webSocketUrl.searchParams.set(
        'extra',
        JSON.stringify(this.options.extra),
      );
    }
    if (this.options.maxInFlight !== undefined) {
      webSocketUrl.searchParams.set(
        'maxInFlight',
        String(this.options.maxInFlight),
      );
    }
    return webSocketUrl.toString();
  }

  private handleMessage(
    webSocket: WebSocketLike,
    messageData: unknown,
  ): void {
    if (this.webSocket !== webSocket) {
      return;
    }
    const message = this.parseMessage(messageData);
    if (!message) {
      return;
    }
    if (message.type === 'welcome') {
      this.handleWelcome(message);
      return;
    }
    if (message.type === 'job' && this.isRpcJob(message)) {
      void this.handleJob(webSocket, message as unknown as RpcJob);
    }
  }

  private parseMessage(messageData: unknown): Record<string, unknown> | null {
    try {
      const serializedMessage =
        typeof messageData === 'string'
          ? messageData
          : String(messageData);
      const parsedMessage: unknown = JSON.parse(serializedMessage);
      return parsedMessage !== null && typeof parsedMessage === 'object'
        ? (parsedMessage as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private handleWelcome(message: Record<string, unknown>): void {
    if (message.clientId !== this.options.clientId) {
      this.reportError(new Rer0RpcError('welcome clientId 与本地设备不一致'));
      this.webSocket?.close(4003, 'clientId mismatch');
      return;
    }
    this.reconnectAttempt = 0;
    this.setState('online');
    this.startHeartbeat();
  }

  private isRpcJob(message: Record<string, unknown>): boolean {
    return (
      message.type === 'job' &&
      typeof message.requestId === 'string' &&
      typeof message.project === 'string' &&
      typeof message.action === 'string' &&
      typeof message.timeoutSeconds === 'number'
    );
  }

  private async handleJob(
    webSocket: WebSocketLike,
    job: RpcJob,
  ): Promise<void> {
    if (job.deadlineAt !== undefined && job.deadlineAt <= Date.now()) {
      this.sendResult(webSocket, job, {
        status: 'timeout',
        isOk: false,
        httpCode: 408,
        error: 'job deadline 已过期',
      });
      return;
    }
    const handler = this.actionHandlers.get(job.action) ?? this.defaultHandler;
    if (!handler) {
      this.sendResult(webSocket, job, {
        status: 'error',
        isOk: false,
        httpCode: 404,
        error: `未注册 Action: ${job.action}`,
      });
      return;
    }
    try {
      this.sendResult(
        webSocket,
        job,
        await this.executeWithTimeout(job, handler),
      );
    } catch (error) {
      this.sendResult(webSocket, job, {
        status: 'error',
        isOk: false,
        httpCode: 500,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private executeWithTimeout(
    job: RpcJob,
    handler: DeviceActionHandler,
  ): Promise<DeviceActionResult> {
    const timeoutMilliseconds = this.resolveTimeoutMilliseconds(job);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          resolve({
            status: 'timeout',
            isOk: false,
            httpCode: 408,
            error: `Action 执行超过 ${timeoutMilliseconds} ms`,
          }),
        timeoutMilliseconds,
      );
      Promise.resolve(handler(job)).then(
        (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  private resolveTimeoutMilliseconds(job: RpcJob): number {
    const configuredTimeout = Math.max(1, job.timeoutSeconds * 1000);
    if (job.deadlineAt === undefined) {
      return configuredTimeout;
    }
    return Math.max(
      1,
      Math.min(configuredTimeout, job.deadlineAt - Date.now()),
    );
  }

  private sendResult(
    webSocket: WebSocketLike,
    job: RpcJob,
    result: DeviceActionResult,
  ): void {
    this.send(
      {
        type: 'result',
        requestId: job.requestId,
        clientId: this.options.clientId,
        status: result.status ?? (result.isOk === false ? 'error' : 'ok'),
        is_ok: result.isOk ?? true,
        httpCode: result.httpCode ?? (result.isOk === false ? 500 : 200),
        ...(result.payload === undefined ? {} : { payload: result.payload }),
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.appAudit === undefined
          ? {}
          : { appAudit: result.appAudit }),
      },
      webSocket,
    );
  }

  private send(
    message: Record<string, unknown>,
    webSocket = this.webSocket,
  ): void {
    if (webSocket?.readyState !== WEB_SOCKET_OPEN_STATE) {
      this.reportError(new Rer0RpcError('设备 WebSocket 当前不可写'));
      return;
    }
    webSocket.send(JSON.stringify(message));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(
      () => this.send({ type: 'heartbeat' }),
      this.options.heartbeatIntervalMilliseconds ?? 10_000,
    );
  }

  private handleClose(
    webSocket: WebSocketLike,
    event: WebSocketCloseEvent,
  ): void {
    if (this.webSocket !== webSocket) {
      return;
    }
    this.webSocket = undefined;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (!this.shouldRun) {
      this.setState('stopped');
      return;
    }
    if (event.code === 4001) {
      this.shouldRun = false;
      this.setState('stopped');
      this.reportError(new Rer0RpcAuthenticationError());
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    this.setState('reconnecting');
    const initialDelay =
      this.options.reconnectInitialDelayMilliseconds ?? 500;
    const maximumDelay =
      this.options.reconnectMaximumDelayMilliseconds ?? 30_000;
    const reconnectDelay = Math.min(
      maximumDelay,
      initialDelay * 2 ** (this.reconnectAttempt - 1),
    );
    this.reconnectTimer = setTimeout(
      () => this.openConnection('reconnecting'),
      reconnectDelay,
    );
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(state: DeviceConnectionState): void {
    this.connectionState = state;
    this.options.onStateChange?.({
      state,
      reconnectAttempt: this.reconnectAttempt,
    });
  }

  private reportError(error: Error): void {
    this.options.onError?.(error);
  }
}

function ensurePositive(name: string, value: number | undefined): void {
  if (value !== undefined && value <= 0) {
    throw new RangeError(`${name} 必须大于 0`);
  }
}
