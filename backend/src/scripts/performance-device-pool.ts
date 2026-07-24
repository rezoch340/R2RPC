import { randomInt } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';

interface PerformanceDeviceJob {
  type: 'job';
  requestId: string;
  action: string;
  payload: unknown;
}

interface PerformanceDeviceMessage {
  type?: string;
  clientId?: string;
  requestId?: string;
  action?: string;
  payload?: unknown;
}

export interface PerformanceDevicePoolInput {
  baseUrl: string;
  deviceToken: string;
  projectName: string;
  virtualDeviceCount: number;
  connectionTimeoutMilliseconds: number;
}

export class PerformanceDevicePool {
  readonly clientIds: string[];
  private readonly webSockets = new Map<string, WebSocket>();
  private readonly processedJobs = new Map<string, number>();

  constructor(private readonly input: PerformanceDevicePoolInput) {
    const normalizedProjectName = input.projectName.replace(
      /[^a-zA-Z0-9_-]/g,
      '-',
    );
    this.clientIds = Array.from(
      { length: input.virtualDeviceCount },
      (unusedValue, deviceIndex) =>
        `performance-${normalizedProjectName}-${String(deviceIndex + 1).padStart(2, '0')}`,
    );
  }

  async connect(): Promise<void> {
    await Promise.all(
      this.clientIds.map((clientId) => this.connectDevice(clientId)),
    );
  }

  randomClientId(): string {
    return this.clientIds[randomInt(this.clientIds.length)];
  }

  jobCounts(): Record<string, number> {
    return Object.fromEntries(
      this.clientIds.map((clientId) => [
        clientId,
        this.processedJobs.get(clientId) ?? 0,
      ]),
    );
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.webSockets.values()].map((webSocket) =>
        this.closeWebSocket(webSocket),
      ),
    );
    this.webSockets.clear();
  }

  private connectDevice(clientId: string): Promise<void> {
    return new Promise((resolveConnection, rejectConnection) => {
      const webSocket = new WebSocket(this.deviceWebSocketUrl(clientId));
      this.webSockets.set(clientId, webSocket);
      let connectionReady = false;
      const connectionTimer = setTimeout(() => {
        webSocket.terminate();
        rejectConnection(new Error(`虚拟设备连接超时: ${clientId}`));
      }, this.input.connectionTimeoutMilliseconds);

      webSocket.on('message', (messageData) => {
        const message = this.parseMessage(messageData);
        if (!message) {
          return;
        }
        if (message.type === 'welcome' && message.clientId === clientId) {
          connectionReady = true;
          clearTimeout(connectionTimer);
          resolveConnection();
          return;
        }
        if (message.type === 'job') {
          this.respondToJob(webSocket, clientId, message);
        }
      });
      webSocket.on('error', (error) => {
        if (connectionReady) {
          return;
        }
        clearTimeout(connectionTimer);
        rejectConnection(
          new Error(`虚拟设备连接失败 ${clientId}: ${error.message}`),
        );
      });
      webSocket.on('close', () => {
        this.webSockets.delete(clientId);
        if (connectionReady) {
          return;
        }
        clearTimeout(connectionTimer);
        rejectConnection(new Error(`虚拟设备连接提前关闭: ${clientId}`));
      });
    });
  }

  private deviceWebSocketUrl(clientId: string): string {
    const webSocketUrl = new URL('/api/client/ws', this.input.baseUrl);
    webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    webSocketUrl.searchParams.set('token', this.input.deviceToken);
    webSocketUrl.searchParams.set('clientId', clientId);
    webSocketUrl.searchParams.set('platform', 'docker-performance');
    webSocketUrl.searchParams.set('maxInFlight', '512');
    webSocketUrl.searchParams.set(
      'extra',
      JSON.stringify({ source: 'docker-performance-suite' }),
    );
    return webSocketUrl.toString();
  }

  private parseMessage(messageData: RawData): PerformanceDeviceMessage | null {
    try {
      return JSON.parse(
        this.serializeMessage(messageData),
      ) as PerformanceDeviceMessage;
    } catch {
      return null;
    }
  }

  private serializeMessage(messageData: RawData): string {
    if (Array.isArray(messageData)) {
      return Buffer.concat(messageData).toString();
    }
    if (messageData instanceof ArrayBuffer) {
      return Buffer.from(messageData).toString();
    }
    return messageData.toString();
  }

  private respondToJob(
    webSocket: WebSocket,
    clientId: string,
    message: PerformanceDeviceMessage,
  ): void {
    if (
      typeof message.requestId !== 'string' ||
      typeof message.action !== 'string'
    ) {
      return;
    }
    const job: PerformanceDeviceJob = {
      type: 'job',
      requestId: message.requestId,
      action: message.action,
      payload: message.payload,
    };
    this.processedJobs.set(
      clientId,
      (this.processedJobs.get(clientId) ?? 0) + 1,
    );
    webSocket.send(
      JSON.stringify({
        type: 'result',
        requestId: job.requestId,
        clientId,
        status: 'ok',
        is_ok: true,
        payload: {
          message: 'hello',
          action: job.action,
          deviceClientId: clientId,
          requestPayload: job.payload,
        },
      }),
    );
  }

  private closeWebSocket(webSocket: WebSocket): Promise<void> {
    if (webSocket.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolveClose) => {
      const closeTimer = setTimeout(() => {
        webSocket.terminate();
        resolveClose();
      }, 1000);
      webSocket.once('close', () => {
        clearTimeout(closeTimer);
        resolveClose();
      });
      webSocket.close();
    });
  }
}
