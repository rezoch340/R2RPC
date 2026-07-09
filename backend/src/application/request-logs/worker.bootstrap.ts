import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '../../infrastructure/config/config.service';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { MetricsService } from '../metrics/metrics.service';

// worker 启动时挂上 repair 定时任务(每 5 分钟扫一次陈旧 pending)
@Injectable()
export class WorkerBootstrap implements OnModuleInit {
  private readonly logger = new Logger('WorkerBootstrap');

  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenance: Queue,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // worker 启动即对账最近 N 天,修正增量累加的丢/重(失败不阻断启动,但要留痕)
    await this.metrics
      .rebuildRecent(this.config.retention.rawRetentionDays)
      .catch((e) => this.logger.error(`启动对账失败: ${(e as Error).message}`));
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
    await this.maintenance.add(
      'metrics-cleanup',
      {},
      {
        repeat: { every: 5 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
