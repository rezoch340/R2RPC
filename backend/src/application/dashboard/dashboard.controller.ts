import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('adminJwt')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // 权限沿用 read/metrics:概览的主体是请求指标,不新增 subject
  @Get('overview')
  @RequirePermission('read', 'metrics')
  @ApiOperation({
    summary: '仪表盘概览(功能组/设备计数 + 请求指标 + 7 天趋势)',
  })
  overview() {
    return this.dashboard.overview();
  }
}
