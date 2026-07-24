import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { QueryRequestOptionsDto } from './dto/query-request-options.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { MonitorService } from './monitor.service';

@ApiTags('monitor')
@ApiBearerAuth('adminJwt')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('requests')
  @RequirePermission('read', 'monitor')
  @ApiOperation({ summary: '请求记录列表(查 PG 脊柱,不返 payload)' })
  list(@Query() query: QueryRequestsDto) {
    return this.monitor.list({
      project: query.project,
      action: query.action,
      clientId: query.clientId,
      status: query.status,
      payloadState: query.payloadState,
      minimumLatencyMs: query.minimumLatencyMs,
      maximumLatencyMs: query.maximumLatencyMs,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('request-options')
  @RequirePermission('read', 'monitor')
  @ApiOperation({
    summary:
      '请求筛选下拉选项(去重 project/action/client,联动过滤 + 实体仍存在)',
  })
  requestOptions(@Query() query: QueryRequestOptionsDto) {
    return this.monitor.requestOptions({
      project: query.project,
      action: query.action,
      clientId: query.clientId,
    });
  }

  @Get('requests/:requestId')
  @RequirePermission('read', 'monitor')
  @ApiOperation({
    summary: '请求详情(PG 脊柱 + 懒加载 Manticore payload/AppAudit)',
  })
  @ApiOkResponse({
    description:
      '返回请求/响应 payload；设备上报且校验通过时 appAudit 为 V1 Step 结构，否则为 null',
  })
  async detail(@Param('requestId') requestId: string) {
    const requestDetail = await this.monitor.detail(requestId);
    if (!requestDetail) {
      throw new NotFoundException('请求日志不存在');
    }
    return requestDetail;
  }
}
