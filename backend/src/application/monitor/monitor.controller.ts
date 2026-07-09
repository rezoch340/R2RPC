import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { QueryRequestOptionsDto } from './dto/query-request-options.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { MonitorService } from './monitor.service';

@ApiTags('monitor')
@ApiBearerAuth()
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('requests')
  @RequirePermission('read', 'monitor')
  @ApiOperation({ summary: '请求记录列表(查 PG 脊柱,不返 payload)' })
  list(@Query() q: QueryRequestsDto) {
    return this.monitor.list({
      project: q.project,
      action: q.action,
      clientId: q.clientId,
      status: q.status,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Get('request-options')
  @RequirePermission('read', 'monitor')
  @ApiOperation({
    summary:
      '请求筛选下拉选项(去重 project/action/client,联动过滤 + 实体仍存在)',
  })
  requestOptions(@Query() q: QueryRequestOptionsDto) {
    return this.monitor.requestOptions({
      project: q.project,
      action: q.action,
      clientId: q.clientId,
    });
  }

  @Get('requests/:requestId')
  @RequirePermission('read', 'monitor')
  @ApiOperation({ summary: '请求详情(PG 脊柱 + 懒加载 Manticore payload)' })
  async detail(@Param('requestId') requestId: string) {
    const d = await this.monitor.detail(requestId);
    if (!d) throw new NotFoundException('请求日志不存在');
    return d;
  }
}
