import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { WsModule } from '../../infrastructure/ws/ws.module';
import { RequestLogsModule } from '../request-logs/request-logs.module';
import { RpcController } from './rpc.controller';
import { RpcService } from './rpc.service';

@Module({
  // WsModule 提供 Presence/ConnectionRegistry;QueueModule 入队;RequestLogsModule 降级同步写 PG 脊柱
  imports: [WsModule, QueueModule, RequestLogsModule],
  controllers: [RpcController],
  providers: [RpcService],
})
export class RpcModule {}
