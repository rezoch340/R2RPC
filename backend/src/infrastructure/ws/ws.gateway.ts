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
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';

// socket 上挂的会话上下文(设备可属多 project)
type ClientSocket = WebSocket & {
  _clientId?: string;
  _projects?: number[];
  _maxInFlight?: number;
  _lastActivity?: number;
  _pingTimer?: NodeJS.Timeout;
};

// 单帧上限 4 MiB(ws.Server maxPayload,超限自动 close 1009);WsAdapter 透传装饰器选项
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const PING_INTERVAL_MS = 5000; // 服务端主动 ping
const READ_TIMEOUT_MS = 20000; // 无活动(message/pong)超此即判离线断开

// 设备常驻连接网关(路径 /api/client/ws)。鉴权:device token(?token) + 自生成 clientId(?clientId)。
@WebSocketGateway({ path: '/api/client/ws', maxPayload: MAX_PAYLOAD_BYTES })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WsGateway');

  constructor(
    private readonly deviceTokens: DeviceTokenService,
    private readonly devices: DevicesService,
    private readonly presence: PresenceService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async handleConnection(socket: ClientSocket, req: IncomingMessage) {
    let clientId: string;
    let projects: number[];
    let deviceTokenId: number;
    let meta: {
      platform: string | null;
      lastIp: string | null;
      extra: string | null;
      maxInFlight: number;
    };
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const cid = url.searchParams.get('clientId');
      if (!token || !cid) throw new Error('missing token/clientId');
      const platform = url.searchParams.get('platform');
      const extra = url.searchParams.get('extra');
      const maxInFlight = this.presence.clampMaxInFlight(
        url.searchParams.get('maxInFlight'),
      );
      const xff = req.headers['x-forwarded-for'];
      const lastIp =
        (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        null;
      const v = await this.deviceTokens.validateForConnect(token);
      if (!v) throw new Error('invalid device token');
      clientId = cid;
      projects = v.projectIds;
      deviceTokenId = v.tokenId;
      meta = { platform, lastIp, extra, maxInFlight };
    } catch {
      this.logger.warn('WS 鉴权失败,关闭连接');
      socket.close(4001, 'unauthorized');
      return;
    }

    socket._clientId = clientId;
    socket._projects = projects;
    socket._maxInFlight = meta.maxInFlight;
    try {
      // redis/db 抖动时直接关连接,设备会自动重连等基础设施恢复
      await this.registry.register(clientId, socket);
      await this.devices.registerOnline(clientId, deviceTokenId, meta);
      await this.presence.online(clientId, projects);
      await this.presence.setMaxInFlight(clientId, meta.maxInFlight);
      await this.presence.resetInFlight(clientId);
    } catch (e) {
      this.logger.warn(`WS 上线失败(基础设施不可用): ${(e as Error).message}`);
      socket.close(4503, 'infra unavailable');
      return;
    }
    socket.on('message', (data: RawData) => {
      socket._lastActivity = Date.now();
      const raw = Array.isArray(data)
        ? Buffer.concat(data).toString()
        : Buffer.isBuffer(data)
          ? data.toString()
          : Buffer.from(data).toString();
      void this.onMessage(socket, raw).catch(() => undefined);
    });
    this.send(socket, {
      type: 'welcome',
      clientId,
      projects,
      maxInFlight: meta.maxInFlight,
    });
    // 服务端主动 ping + 读超时:无活动(message/pong)超 READ_TIMEOUT 即断开
    socket._lastActivity = Date.now();
    socket.on('pong', () => {
      socket._lastActivity = Date.now();
    });
    socket._pingTimer = setInterval(() => {
      if (socket.readyState !== 1) return;
      if (Date.now() - (socket._lastActivity ?? 0) > READ_TIMEOUT_MS) {
        this.logger.warn(
          `设备读超时(${READ_TIMEOUT_MS}ms 无活动),断开: ${socket._clientId}`,
        );
        socket.terminate();
        return;
      }
      socket.ping();
    }, PING_INTERVAL_MS);
    this.logger.log(`设备上线: ${clientId}@[${projects.join(',')}]`);
  }

  async handleDisconnect(socket: ClientSocket) {
    if (socket._pingTimer) clearInterval(socket._pingTimer);
    const clientId = socket._clientId;
    const projects = socket._projects;
    if (clientId) {
      try {
        const wasOwner = await this.registry.unregister(clientId, socket);
        if (wasOwner && projects) {
          await this.presence.offline(clientId, projects);
          await this.devices.markOffline(clientId);
        }
        this.logger.log(`设备下线: ${clientId}`);
      } catch (e) {
        this.logger.warn(`WS 下线清理失败: ${(e as Error).message}`);
      }
    }
  }

  private async onMessage(socket: ClientSocket, raw: string) {
    try {
      let msg: { type?: string; requestId?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw) as {
          type?: string;
          requestId?: string;
          [k: string]: unknown;
        };
      } catch {
        return;
      }
      switch (msg.type) {
        case 'heartbeat':
          if (socket._clientId) {
            await this.presence.refresh(socket._clientId);
            if (socket._maxInFlight)
              await this.presence.setMaxInFlight(
                socket._clientId,
                socket._maxInFlight,
              );
            await this.registry.refreshSession(socket._clientId);
          }
          this.send(socket, { type: 'heartbeatAck' });
          break;
        case 'result': {
          const outcome = await this.registry.handleResult(
            msg.requestId ?? '',
            socket._clientId ?? '',
            msg,
          );
          this.send(socket, {
            type: 'resultAck',
            requestId: msg.requestId,
            outcome,
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      this.logger.warn(`ws message 处理失败: ${(e as Error).message}`);
    }
  }

  private send(socket: WebSocket, obj: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(obj));
  }
}
