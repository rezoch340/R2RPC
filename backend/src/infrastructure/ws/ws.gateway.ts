import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';

// 手机端常驻连接网关(路径 /api/client/ws)。骨架:仅连接生命周期占位,
// welcome/job/heartbeat/result 分发在后续实现。
@WebSocketGateway({ path: '/api/client/ws' })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WsGateway');

  handleConnection() {
    this.logger.log('手机端连接建立');
  }

  handleDisconnect() {
    this.logger.log('手机端连接断开');
  }
}
