import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('read', 'device')
  @ApiOperation({
    summary: '设备列表(持久态:online/status/platform/last_ip/last_seen)',
  })
  list() {
    return this.devices.list();
  }

  @Get(':id')
  @RequirePermission('read', 'device')
  @ApiOperation({ summary: '设备详情' })
  async get(@Param('id', ParseIntPipe) deviceId: number) {
    const device = await this.devices.get(deviceId);
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    return device;
  }
}
