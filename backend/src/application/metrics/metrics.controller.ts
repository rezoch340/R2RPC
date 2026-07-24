import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { QueryTrendDto } from './dto/query-trend.dto';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth('adminJwt')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  @RequirePermission('read', 'metrics')
  @ApiOperation({
    summary: '指标总览(总量 / 成功失败 / 平均延迟 / 分状态 / 分组)',
  })
  overview() {
    return this.metrics.overview();
  }

  @Get('weekly')
  @RequirePermission('read', 'metrics')
  @ApiOperation({
    summary: '近7天设备指标(按 clientId×project 汇总;可选 ?project)',
  })
  @ApiQuery({
    name: 'project',
    required: false,
    description: '可选功能组名称；省略时返回全部功能组。',
  })
  weekly(@Query('project') project?: string) {
    return this.metrics.weekly(project);
  }

  @Get('trend')
  @RequirePermission('read', 'metrics')
  @ApiOperation({
    summary: '按天趋势序列(默认近7天,缺天补零;可选 ?days ?project)',
  })
  trend(@Query() query: QueryTrendDto) {
    return this.metrics.trend(query.days ?? 7, query.project);
  }
}
