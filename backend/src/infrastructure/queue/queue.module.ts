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
      useFactory: (configuration: ConfigService) => ({
        connection: {
          host: configuration.redis.host,
          port: configuration.redis.port,
          password: configuration.redis.password ?? undefined,
          db: configuration.redis.db,
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
