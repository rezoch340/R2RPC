import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '../../infrastructure/config/config.service';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { DevicesService } from '../devices/devices.service';
import { RequestLogsService } from './request-logs.service';

const STALE_PENDING_MS = 10 * 60 * 1000;

// 定时维护:① repair 陈旧 pending;② request_logs 保留/裁剪。按 job.name 分派。
@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger('MaintenanceProcessor');

  constructor(
    private readonly logs: RequestLogsService,
    private readonly config: ConfigService,
    private readonly devices: DevicesService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'repair-stale-pending') return this.repairStalePending();
    if (job.name === 'retention-sweep') return this.retentionSweep();
    if (job.name === 'mark-devices-stale') return this.markDevicesStale();
  }

  // 扫描 worker 崩溃遗留的陈旧 pending(payload 已无从补),标 unavailable
  private async repairStalePending() {
    const stale = await this.logs.findStalePending(STALE_PENDING_MS, 500);
    for (const r of stale) {
      await this.logs.markState(r.requestId, 'unavailable');
    }
    if (stale.length) {
      this.logger.warn(
        `repair:${stale.length} 条陈旧 pending 标记为 unavailable`,
      );
    }
    return { marked: stale.length };
  }

  // 按天清理 + 按 scope 裁剪 request_logs
  private async retentionSweep() {
    const { rawRetentionDays, keepLatestPerScope } = this.config.retention;
    const cleaned = await this.logs.cleanupOldRequests(rawRetentionDays);
    const trimmed = await this.logs.trimScopes(keepLatestPerScope);
    if (cleaned || trimmed) {
      this.logger.log(
        `retention: 清理 ${cleaned} 条(>${rawRetentionDays}天), 裁剪 ${trimmed} 条(每scope>${keepLatestPerScope})`,
      );
    }
    return { cleaned, trimmed };
  }

  // presence 对账,把 PG 里 online 但 Redis 已掉线的设备置 stale
  private async markDevicesStale() {
    const stale = await this.devices.markStaleOffline();
    if (stale)
      this.logger.warn(`stale: ${stale} 台设备 presence 已过期,置 stale`);
    return { stale };
  }
}
