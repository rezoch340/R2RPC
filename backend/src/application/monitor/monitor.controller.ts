import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
      group: q.group,
      action: q.action,
      clientId: q.clientId,
      status: q.status,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      pageSize: q.pageSize,
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
