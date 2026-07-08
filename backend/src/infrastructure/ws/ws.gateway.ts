import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';

// socket 上挂的会话上下文
type ClientSocket = WebSocket & { _clientId?: string; _group?: string };

// 手机端常驻连接网关(路径 /api/client/ws)。按 type 字段裸解析,不用 @SubscribeMessage。
@WebSocketGateway({ path: '/api/client/ws' })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly presence: PresenceService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async handleConnection(socket: ClientSocket, req: IncomingMessage) {
    const token = this.extractToken(req);
    let clientId: string;
    let group: string;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        clientId?: string;
        group?: string;
      }>(token ?? '');
      clientId = payload.clientId ?? payload.sub;
      group = payload.group ?? '';
      if (!clientId || !group) throw new Error('missing claims');
    } catch {
      this.logger.warn('WS 鉴权失败,关闭连接');
      socket.close(4001, 'unauthorized');
      return;
    }

    socket._clientId = clientId;
    socket._group = group;
    this.registry.register(clientId, socket);
    await this.presence.online(clientId, group);
    socket.on('message', (data: RawData) => this.onMessage(socket, data.toString()));
    this.send(socket, { type: 'welcome', clientId, group });
    this.logger.log(`手机端上线: ${clientId}@${group}`);
  }

  async handleDisconnect(socket: ClientSocket) {
    const clientId = socket._clientId;
    const group = socket._group;
    if (clientId) {
      this.registry.unregister(clientId);
      if (group) await this.presence.offline(clientId, group);
      this.logger.log(`手机端下线: ${clientId}`);
    }
  }

  private async onMessage(socket: ClientSocket, raw: string) {
    let msg: { type?: string; requestId?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'heartbeat':
        if (socket._clientId) await this.presence.refresh(socket._clientId);
        this.send(socket, { type: 'heartbeatAck' });
        break;
      case 'result': {
        const outcome = this.registry.resolveResult(
          msg.requestId ?? '',
          socket._clientId ?? '',
          msg,
        );
        this.send(socket, { type: 'resultAck', requestId: msg.requestId, outcome });
        break;
      }
      default:
        // 未知类型忽略
        break;
    }
  }

  private extractToken(req: IncomingMessage): string | null {
    try {
      return new URL(req.url ?? '', 'http://localhost').searchParams.get('token');
    } catch {
      return null;
    }
  }

  private send(socket: WebSocket, obj: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(obj));
  }
}
