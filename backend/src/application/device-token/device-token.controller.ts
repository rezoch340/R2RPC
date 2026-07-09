import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthedRequest } from '../../common/types/authed-request';
import { DeviceTokenService } from './device-token.service';
import { CreateDeviceTokenDto } from './dto/create-device-token.dto';

@ApiTags('device-token')
@ApiBearerAuth()
@Controller('device-tokens')
export class DeviceTokenController {
  constructor(private readonly tokens: DeviceTokenService) {}

  @Post()
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '生成 device token(返回明文,供 SDK 配置)' })
  create(@Body() dto: CreateDeviceTokenDto, @Req() req: AuthedRequest) {
    return this.tokens.create({
      name: dto.name,
      projects: dto.projects,
      description: dto.description,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdBy: req.user?.id,
    });
  }

  @Get()
  @RequirePermission('manage', 'device-token')
  @ApiOperation({
    summary: '列表:所有 device token(含明文、project 名、在线设备数)',
  })
  list() {
    return this.tokens.list();
  }

  @Post(':id/revoke')
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '撤销 device token' })
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.revoke(id);
  }

  @Delete(':id')
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '删除 device token(软删,与撤销正交)' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.delete(id);
  }
}
