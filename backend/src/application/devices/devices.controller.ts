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
  async get(@Param('id', ParseIntPipe) id: number) {
    const d = await this.devices.get(id);
    if (!d) throw new NotFoundException('设备不存在');
    return d;
  }
}
