import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseEntityIdPipe } from '../../common/pipes/parse-entity-id.pipe';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DevicesService } from './devices.service';
import { QueryDevicesDto } from './dto/query-devices.dto';

@ApiTags('devices')
@ApiBearerAuth('adminJwt')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('read', 'device')
  @ApiOperation({
    summary:
      '设备列表(持久态:online/status/platform/last_ip/last_seen),服务端筛选分页',
  })
  list(@Query() query: QueryDevicesDto) {
    return this.devices.list(query);
  }

  @Get(':id')
  @RequirePermission('read', 'device')
  @ApiOperation({ summary: '设备详情' })
  async get(@Param('id', ParseEntityIdPipe) deviceId: number) {
    const device = await this.devices.get(deviceId);
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    return device;
  }
}
