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

// socket 上挂的会话上下文(设备可属多组)
type ClientSocket = WebSocket & { _clientId?: string; _groups?: number[] };

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
    let groups: number[];
    try {
      // groups 来自 token(登录时已由 client_groups 解析,可信);校验通不过就不能信任其 groups
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        clientId?: string;
        groups?: number[];
      }>(token ?? '');
      clientId = payload.clientId ?? payload.sub;
      groups = payload.groups ?? [];
      if (!clientId || !Array.isArray(payload.groups)) throw new Error('missing claims');
    } catch {
      this.logger.warn('WS 鉴权失败,关闭连接');
      socket.close(4001, 'unauthorized');
      return;
    }

    socket._clientId = clientId;
    socket._groups = groups;
    try {
      // redis 抖动会让这两个 await 拒绝;基础设施不可用时直接关连接,设备会自动重连等 redis 恢复
      await this.registry.register(clientId, socket);
      await this.presence.online(clientId, groups);
    } catch (e) {
      this.logger.warn(`WS 上线失败(基础设施不可用): ${(e as Error).message}`);
      socket.close(4503, 'infra unavailable');
      return;
    }
    socket.on('message', (data: RawData) => {
      // 兜底:onMessage 内部已 try/catch,这里再包一层防止 Promise 悬空导致 unhandledRejection
      void this.onMessage(socket, data.toString()).catch(() => undefined);
    });
    this.send(socket, { type: 'welcome', clientId, groups });
    this.logger.log(`手机端上线: ${clientId}@[${groups.join(',')}]`);
  }

  async handleDisconnect(socket: ClientSocket) {
    const clientId = socket._clientId;
    const groups = socket._groups;
    if (clientId) {
      try {
        // wasOwner=false 说明本连接的会话已被更晚的注册(同一手机快速重连/换实例)覆盖,
        // 这里只是一条延迟到达的旧 close,不能再跑下线清理,否则会把新连接标脏下线。
        const wasOwner = await this.registry.unregister(clientId, socket);
        if (wasOwner && groups) await this.presence.offline(clientId, groups);
        this.logger.log(`手机端下线: ${clientId}`);
      } catch (e) {
        // 下线清理是尽力而为(best-effort);redis 抖动导致失败不应影响进程,记日志即可
        this.logger.warn(`WS 下线清理失败: ${(e as Error).message}`);
      }
    }
  }

  private async onMessage(socket: ClientSocket, raw: string) {
    try {
      let msg: { type?: string; requestId?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'heartbeat':
          if (socket._clientId) {
            await this.presence.refresh(socket._clientId);
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
          this.send(socket, { type: 'resultAck', requestId: msg.requestId, outcome });
          break;
        }
        default:
          // 未知类型忽略
          break;
      }
    } catch (e) {
      // 整体兜底:redis 抖动等基础设施异常不能让本方法拒绝(否则触发 unhandledRejection 杀进程)
      this.logger.warn(`ws message 处理失败: ${(e as Error).message}`);
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
