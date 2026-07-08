import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '../config/config.service';
import { QueueService } from './queue.service';
import { QUEUE } from './queue.constants';

// BullMQ 根配置(连 Redis)+ 注册 4 个队列
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host: cfg.redis.host,
          port: cfg.redis.port,
          password: cfg.redis.password ?? undefined,
          db: cfg.redis.db,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE.REQUEST_LOG },
      { name: QUEUE.METRICS },
      { name: QUEUE.MAINTENANCE },
      { name: QUEUE.DEAD_LETTER },
    ),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
