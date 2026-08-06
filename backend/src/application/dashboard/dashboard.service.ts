import { Injectable } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';
import { MetricsService } from '../metrics/metrics.service';
import { ProjectsService } from '../projects/projects.service';

// 仪表盘只要几个数字和一条趋势。此前前端拼四个列表接口来凑:两次 ?pageSize=1 偷 total,
// 外加一次 /projects/info 跑全量设备聚合却只用了 length。这里一次算完。
const TREND_DAYS = 7;

@Injectable()
export class DashboardService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly devices: DevicesService,
    private readonly metrics: MetricsService,
  ) {}

  async overview() {
    // 四组数据互不依赖,并行取
    const [projectSummary, deviceSummary, requestOverview, trend] =
      await Promise.all([
        this.projects.summary(),
        this.devices.summary(),
        this.metrics.overview(),
        this.metrics.trend(TREND_DAYS),
      ]);
    return {
      projects: projectSummary,
      devices: deviceSummary,
      requests: requestOverview,
      trend,
    };
  }
}
