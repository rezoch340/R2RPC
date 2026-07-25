import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { DeviceTokenService } from '../../application/device-token/device-token.service';
import { DevicesService } from '../../application/devices/devices.service';
import { ConfigService } from '../config/config.service';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';

// socket 上挂的会话上下文(设备可属多 project)
type ClientSocket = WebSocket & {
  _clientId?: string;
  _deviceTokenId?: number;
  _projects?: number[];
  _maxInFlight?: number;
  _lastActivity?: number;
  _pingTimer?: NodeJS.Timeout;
};

interface AuthenticatedDeviceConnection {
  clientId: string;
  projectIds: number[];
  deviceTokenId: number;
  metadata: {
    platform: string | null;
    lastIp: string | null;
    extra: string | null;
    maxInFlight: number;
  };
}

// ws 8.21 内部 Receiver 的相关字段/方法(见 node_modules/ws/lib/receiver.js):
// getInfo 处同步解析帧头并设 _fin/_opcode;控制帧强制 FIN,故解析后 _fin===false 只可能是数据帧分片。
// createError 走 ws 自身的协议错误链路(→ 'error' → websocket.close(code))。
type WebSocketReceiver = {
  _bufferedBytes: number;
  _fin: boolean;
  _errored: boolean;
  getInfo: (callback: (error?: Error) => void) => void;
  createError: (...args: unknown[]) => Error;
};

// 单帧上限 4 MiB(ws.Server maxPayload,超限自动 close 1009);WsAdapter 透传装饰器选项
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const PING_INTERVAL_MILLISECONDS = 5000; // 服务端主动 ping
const READ_TIMEOUT_MILLISECONDS = 20000; // 无活动(message/pong)超此即判离线断开

// 设备常驻连接网关(路径 /api/client/ws)。鉴权:device token(?token) + 自生成 clientId(?clientId)。
@WebSocketGateway({ path: '/api/client/ws', maxPayload: MAX_PAYLOAD_BYTES })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WsGateway');

  constructor(
    private readonly deviceTokenService: DeviceTokenService,
    private readonly devicesService: DevicesService,
    private readonly presenceService: PresenceService,
    private readonly connectionRegistry: ConnectionRegistry,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(socket: ClientSocket, request: IncomingMessage) {
    // DoS 加固:拒分片帧(FIN=0)。须在任何 await 前挂,确保早于设备发首帧被 receiver 处理
    this.rejectFragmentedFrames(socket);
    const connection = await this.authenticate(request);
    if (!connection) {
      this.logger.warn('WS 鉴权失败,关闭连接');
      socket.close(4001, 'unauthorized');
      return;
    }

    this.attachConnectionContext(socket, connection);
    const registered = await this.registerConnection(socket, connection);
    if (!registered) {
      return;
    }

    this.bindMessageHandler(socket);
    this.send(socket, {
      type: 'welcome',
      clientId: connection.clientId,
      projects: connection.projectIds,
      maxInFlight: connection.metadata.maxInFlight,
    });
    this.startHeartbeat(socket);
    this.logger.log(
      `设备上线: ${connection.clientId}@[${connection.projectIds.join(',')}]`,
    );
  }

  private async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedDeviceConnection | null> {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost');
      const token = requestUrl.searchParams.get('token');
      const clientId = requestUrl.searchParams.get('clientId');
      if (!token || !clientId) {
        return null;
      }
      const validatedToken =
        await this.deviceTokenService.validateForConnect(token);
      if (!validatedToken) {
        return null;
      }
      return {
        clientId,
        projectIds: validatedToken.projectIds,
        deviceTokenId: validatedToken.tokenId,
        metadata: {
          platform: requestUrl.searchParams.get('platform'),
          lastIp: this.clientIp(request),
          extra: requestUrl.searchParams.get('extra'),
          maxInFlight: this.presenceService.clampMaxInFlight(
            requestUrl.searchParams.get('maxInFlight'),
          ),
        },
      };
    } catch {
      return null;
    }
  }

  private clientIp(request: IncomingMessage): string | null {
    if (this.configService.app.trustedProxyHops === 0) {
      return request.socket.remoteAddress || null;
    }
    const forwardedFor = request.headers['x-forwarded-for'];
    const forwardedAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor;
    return (
      forwardedAddress?.split(',')[0].trim() ||
      request.socket.remoteAddress ||
      null
    );
  }

  private attachConnectionContext(
    socket: ClientSocket,
    connection: AuthenticatedDeviceConnection,
  ): void {
    socket._clientId = connection.clientId;
    socket._deviceTokenId = connection.deviceTokenId;
    socket._projects = connection.projectIds;
    socket._maxInFlight = connection.metadata.maxInFlight;
  }

  private async registerConnection(
    socket: ClientSocket,
    connection: AuthenticatedDeviceConnection,
  ): Promise<boolean> {
    try {
      // redis/db 抖动时直接关连接,设备会自动重连等基础设施恢复
      await this.connectionRegistry.register(connection.clientId, socket);
      await this.devicesService.registerOnline(
        connection.clientId,
        connection.deviceTokenId,
        connection.metadata,
      );
      await this.presenceService.online(
        connection.clientId,
        connection.projectIds,
      );
      await this.presenceService.setMaxInFlight(
        connection.clientId,
        connection.metadata.maxInFlight,
      );
      await this.presenceService.resetInFlight(connection.clientId);
      return true;
    } catch (error) {
      this.logger.warn(
        `WS 上线失败(基础设施不可用): ${(error as Error).message}`,
      );
      socket.close(4503, 'infra unavailable');
      return false;
    }
  }

  private bindMessageHandler(socket: ClientSocket): void {
    socket.on('message', (messageData: RawData) => {
      socket._lastActivity = Date.now();
      const serializedMessage = this.serializedMessage(messageData);
      void this.onMessage(socket, serializedMessage).catch(() => undefined);
    });
  }

  private serializedMessage(messageData: RawData): string {
    if (Array.isArray(messageData)) {
      return Buffer.concat(messageData).toString();
    }
    if (Buffer.isBuffer(messageData)) {
      return messageData.toString();
    }
    return Buffer.from(messageData).toString();
  }

  private startHeartbeat(socket: ClientSocket): void {
    // 服务端主动 ping + 读超时:无活动(message/pong)超 READ_TIMEOUT 即断开
    socket._lastActivity = Date.now();
    socket.on('pong', () => {
      socket._lastActivity = Date.now();
    });
    socket._pingTimer = setInterval(() => {
      if (socket.readyState !== 1) {
        return;
      }
      if (
        Date.now() - (socket._lastActivity ?? 0) >
        READ_TIMEOUT_MILLISECONDS
      ) {
        this.logger.warn(
          `设备读超时(${READ_TIMEOUT_MILLISECONDS}ms 无活动),断开: ${socket._clientId}`,
        );
        socket.terminate();
        return;
      }
      socket.ping();
    }, PING_INTERVAL_MILLISECONDS);
  }

  async handleDisconnect(socket: ClientSocket) {
    if (socket._pingTimer) {
      clearInterval(socket._pingTimer);
    }
    const clientId = socket._clientId;
    const projectIds = socket._projects;
    if (!clientId) {
      return;
    }
    try {
      const wasOwner = await this.connectionRegistry.unregister(
        clientId,
        socket,
      );
      if (wasOwner && projectIds) {
        await this.presenceService.offline(clientId, projectIds);
        await this.devicesService.markOffline(clientId);
      }
      this.logger.log(`设备下线: ${clientId}`);
    } catch (error) {
      this.logger.warn(`WS 下线清理失败: ${(error as Error).message}`);
    }
  }

  private async onMessage(socket: ClientSocket, serializedMessage: string) {
    try {
      const message = this.parseMessage(serializedMessage);
      if (!message) {
        return;
      }
      switch (message.type) {
        case 'heartbeat':
          await this.handleHeartbeat(socket);
          this.send(socket, { type: 'heartbeatAck' });
          break;
        case 'result': {
          const outcome = await this.connectionRegistry.handleResult(
            message.requestId ?? '',
            socket._clientId ?? '',
            message,
          );
          this.send(socket, {
            type: 'resultAck',
            requestId: message.requestId,
            outcome,
          });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.logger.warn(`ws message 处理失败: ${(error as Error).message}`);
    }
  }

  private parseMessage(
    serializedMessage: string,
  ): { type?: string; requestId?: string; [key: string]: unknown } | null {
    try {
      return JSON.parse(serializedMessage) as {
        type?: string;
        requestId?: string;
        [key: string]: unknown;
      };
    } catch {
      return null;
    }
  }

  private async handleHeartbeat(socket: ClientSocket): Promise<void> {
    if (!socket._clientId) {
      return;
    }
    await this.presenceService.refresh(socket._clientId);
    if (socket._maxInFlight) {
      await this.presenceService.setMaxInFlight(
        socket._clientId,
        socket._maxInFlight,
      );
    }
    await this.connectionRegistry.refreshSession(socket._clientId);
  }

  // 拒绝分片帧(FIN=0 的数据帧/延续帧):ws 高层不暴露帧级 FIN(重组后才 onMessage),
  // 故实例级包裹 receiver.getInfo,帧头解析后若 _fin===false 用 ws 自身错误链路以 1009 关闭整条连接。
  // 依赖 ws 内部字段(锁定版本 8.21);若升级后 getInfo 失踪则 fail-open(记一条 error,连接照常,
  // maxPayload+读超时仍兜 DoS 面),不因内部变更把设备连接搞崩。
  private rejectFragmentedFrames(socket: WebSocket) {
    const receiver = (socket as unknown as { _receiver?: WebSocketReceiver })
      ._receiver;
    if (!receiver || typeof receiver.getInfo !== 'function') {
      this.logger.error('拒分片加固失效:ws receiver.getInfo 不可用(ws 变更?)');
      return;
    }
    const originalGetInfo = receiver.getInfo.bind(receiver) as (
      callback: (error?: Error) => void,
    ) => void;
    receiver.getInfo = (callback: (error?: Error) => void) => {
      // 帧头(≥2 字节)已缓冲才可信;不足时 getInfo 早退,_fin 是上一帧陈旧值,不能读
      const hadHeaderBytes = receiver._bufferedBytes >= 2;
      originalGetInfo(callback);
      // getInfo happy-path 不调 cb;此刻它刚同步设完 _fin/_errored(已 errored 则别重复 cb)
      if (hadHeaderBytes && !receiver._errored && receiver._fin === false) {
        callback(
          receiver.createError(
            RangeError,
            'fragmented frames are not allowed',
            true,
            1009,
            'WS_ERR_FRAGMENTED_FRAME',
          ),
        );
      }
    };
  }

  private send(socket: WebSocket, message: unknown) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }
}
