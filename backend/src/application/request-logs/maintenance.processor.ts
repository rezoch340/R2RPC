import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '../../infrastructure/config/config.service';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { DevicesService } from '../devices/devices.service';
import { MetricsService } from '../metrics/metrics.service';
import { RequestLogsService } from './request-logs.service';

const STALE_PENDING_MILLISECONDS = 10 * 60 * 1000;

// 定时维护:① repair 陈旧 pending;② request_logs 保留/裁剪。按 job.name 分派。
@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger('MaintenanceProcessor');

  constructor(
    private readonly logs: RequestLogsService,
    private readonly config: ConfigService,
    private readonly devices: DevicesService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'repair-stale-pending':
        return this.repairStalePending();
      case 'retention-sweep':
        return this.retentionSweep();
      case 'mark-devices-stale':
        return this.markDevicesStale();
      case 'metrics-cleanup':
        return this.metricsCleanup();
      case 'sweep-idle-devices':
        return this.sweepIdleDevices();
      default:
        return undefined;
    }
  }

  // 扫描 worker 崩溃遗留的陈旧 pending(payload 已无从补),标 unavailable
  private async repairStalePending() {
    const staleLogs = await this.logs.findStalePending(
      STALE_PENDING_MILLISECONDS,
      500,
    );
    for (const staleLog of staleLogs) {
      await this.logs.markState(staleLog.requestId, 'unavailable');
    }
    if (staleLogs.length) {
      this.logger.warn(
        `repair:${staleLogs.length} 条陈旧 pending 标记为 unavailable`,
      );
    }
    return { marked: staleLogs.length };
  }

  // 按天清理 + 按 scope 裁剪 request_logs
  private async retentionSweep() {
    const { rawRetentionDays, keepLatestPerScope } = this.config.retention;
    const cleanedCount = await this.logs.cleanupOldRequests(rawRetentionDays);
    const trimmedCount = await this.logs.trimScopes(keepLatestPerScope);
    if (cleanedCount || trimmedCount) {
      this.logger.log(
        `retention: 清理 ${cleanedCount} 条(>${rawRetentionDays}天), 裁剪 ${trimmedCount} 条(每scope>${keepLatestPerScope})`,
      );
    }
    return { cleaned: cleanedCount, trimmed: trimmedCount };
  }

  // presence 对账,把 PG 里 online 但 Redis 已掉线的设备置 stale
  private async markDevicesStale() {
    const staleDeviceCount = await this.devices.markStaleOffline();
    if (staleDeviceCount) {
      this.logger.warn(
        `stale: ${staleDeviceCount} 台设备 presence 已过期,置 stale`,
      );
    }
    return { stale: staleDeviceCount };
  }

  // 长期没再上线的设备软删;设备重新连回来时 registerOnline 会复用原行回滚软删
  private async sweepIdleDevices() {
    const { deviceIdleDeleteDays } = this.config.retention;
    const deletedDeviceCount =
      await this.devices.softDeleteIdle(deviceIdleDeleteDays);
    if (deletedDeviceCount) {
      this.logger.log(
        `idle-sweep: 软删 ${deletedDeviceCount} 台设备(>${deviceIdleDeleteDays}天未上线)`,
      );
    }
    return { deleted: deletedDeviceCount };
  }

  // 按天清理聚合表(device_daily_metrics/rpc_daily_metrics)
  private async metricsCleanup() {
    const { aggregateRetentionDays } = this.config.retention;
    const { rpc: rpcMetricCount, device: deviceMetricCount } =
      await this.metrics.cleanupOldMetrics(aggregateRetentionDays);
    if (rpcMetricCount || deviceMetricCount) {
      this.logger.log(
        `metrics-cleanup: 删聚合 rpc ${rpcMetricCount} + device ${deviceMetricCount}(>${aggregateRetentionDays}天)`,
      );
    }
    return { rpc: rpcMetricCount, device: deviceMetricCount };
  }
}
