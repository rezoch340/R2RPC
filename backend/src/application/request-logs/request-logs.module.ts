import { Module } from '@nestjs/common';
import { RequestLogsController } from './request-logs.controller';
import { RequestLogsService } from './request-logs.service';

// 只提供 RequestLogsService(+ 监控 controller)。BullMQ 处理器只在 worker 进程(WorkerModule)注册,
// 避免 API 进程也去消费队列。
@Module({
  controllers: [RequestLogsController],
  providers: [RequestLogsService],
  exports: [RequestLogsService],
})
export class RequestLogsModule {}
