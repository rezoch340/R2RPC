import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { WsModule } from '../../infrastructure/ws/ws.module';
import { RpcController } from './rpc.controller';
import { RpcService } from './rpc.service';

@Module({
  // WsModule 提供 PresenceService / ConnectionRegistry(同一实例);QueueModule 提供请求日志入队
  imports: [WsModule, QueueModule],
  controllers: [RpcController],
  providers: [RpcService],
})
export class RpcModule {}
