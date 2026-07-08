import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { RequestLogsService } from './request-logs.service';

const STALE_PENDING_MS = 10 * 60 * 1000;

// 定时维护:扫描陈旧 pending(worker 崩溃遗留、payload 已无从补),标记 unavailable。
@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger('MaintenanceProcessor');

  constructor(private readonly logs: RequestLogsService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== 'repair-stale-pending') return;
    const stale = await this.logs.findStalePending(STALE_PENDING_MS, 500);
    for (const r of stale) {
      await this.logs.markState(r.requestId, 'unavailable');
    }
    if (stale.length) {
      this.logger.warn(`repair:${stale.length} 条陈旧 pending 标记为 unavailable`);
    }
    return { marked: stale.length };
  }
}
