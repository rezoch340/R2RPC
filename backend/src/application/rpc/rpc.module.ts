import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { WsModule } from '../../infrastructure/ws/ws.module';
import { AccessTokenModule } from '../access-token/access-token.module';
import { ProjectsModule } from '../projects/projects.module';
import { RequestLogsModule } from '../request-logs/request-logs.module';
import { RpcController } from './rpc.controller';
import { RpcService } from './rpc.service';

@Module({
  // WsModule 提供 Presence/ConnectionRegistry;ProjectsModule 解析 project 名→project id;QueueModule 入队;
  // RequestLogsModule 降级同步写 PG 脊柱;AccessTokenModule 提供 AccessTokenGuard(全局导出,这里显式 import 便于阅读)
  imports: [
    WsModule,
    QueueModule,
    RequestLogsModule,
    ProjectsModule,
    AccessTokenModule,
  ],
  controllers: [RpcController],
  providers: [RpcService],
})
export class RpcModule {}
