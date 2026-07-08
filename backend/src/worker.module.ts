import { Module } from '@nestjs/common';
import { DeadLetterProcessor } from './application/request-logs/dead-letter.processor';
import { MaintenanceProcessor } from './application/request-logs/maintenance.processor';
import { RequestLogProcessor } from './application/request-logs/request-log.processor';
import { RequestLogsModule } from './application/request-logs/request-logs.module';
import { WorkerBootstrap } from './application/request-logs/worker.bootstrap';
import { ConfigModule } from './infrastructure/config/config.module';
import { DbModule } from './infrastructure/db/db.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { SearchModule } from './infrastructure/search/search.module';

// worker 进程根模块:只装冷路径消费者 + 定时维护,不含 HTTP / WS。
@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    SearchModule,
    QueueModule,
    RequestLogsModule,
  ],
  providers: [
    RequestLogProcessor,
    DeadLetterProcessor,
    MaintenanceProcessor,
    WorkerBootstrap,
  ],
})
export class WorkerModule {}
