import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  @RequirePermission('read', 'metrics')
  @ApiOperation({ summary: '指标总览(总量 / 成功失败 / 平均延迟 / 分状态 / 分组)' })
  overview() {
    return this.metrics.overview();
  }
}
