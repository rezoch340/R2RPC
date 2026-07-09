import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE } from '../../infrastructure/queue/queue.constants';

// worker 启动时挂上 repair 定时任务(每 5 分钟扫一次陈旧 pending)
@Injectable()
export class WorkerBootstrap implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenance: Queue,
  ) {}

  async onModuleInit() {
    await this.maintenance.add(
      'repair-stale-pending',
      {},
      {
        repeat: { every: 5 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await this.maintenance.add(
      'retention-sweep',
      {},
      {
        repeat: { every: 5 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await this.maintenance.add(
      'mark-devices-stale',
      {},
      {
        repeat: { every: 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
