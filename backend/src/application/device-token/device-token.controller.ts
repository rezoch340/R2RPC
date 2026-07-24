import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemAudit } from '../../common/decorators/system-audit.decorator';
import type { AuthedRequest } from '../../common/types/authed-request';
import { DeviceTokenService } from './device-token.service';
import { CreateDeviceTokenDto } from './dto/create-device-token.dto';
import { UpdateDeviceTokenProjectsDto } from './dto/update-device-token-projects.dto';

@ApiTags('device-token')
@ApiBearerAuth('adminJwt')
@Controller('device-tokens')
export class DeviceTokenController {
  constructor(private readonly tokens: DeviceTokenService) {}

  @Post()
  @RequirePermission('manage', 'device-token')
  @SystemAudit({
    name: '创建 Device Token',
    action: 'create',
    subject: 'device-token',
    targetType: 'device-token',
    targetNameField: 'name',
    targetResponseField: 'id',
    metadataBodyFields: ['projects', 'expiresAt'],
  })
  @ApiOperation({ summary: '生成 device token(返回明文,供 SDK 配置)' })
  create(@Body() input: CreateDeviceTokenDto, @Req() request: AuthedRequest) {
    return this.tokens.create({
      name: input.name,
      projects: input.projects,
      description: input.description,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      createdBy: request.user?.id,
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

  @Patch(':id/projects')
  @RequirePermission('manage', 'device-token')
  @SystemAudit({
    name: '修改 Device Token 功能组',
    action: 'update',
    subject: 'device-token',
    targetType: 'device-token',
    targetParameter: 'id',
    metadataBodyFields: ['projects'],
  })
  @ApiOperation({ summary: '替换 device token 的功能组作用域' })
  updateProjects(
    @Param('id', ParseIntPipe) deviceTokenId: number,
    @Body() input: UpdateDeviceTokenProjectsDto,
  ) {
    return this.tokens.updateProjects(deviceTokenId, input.projects);
  }

  @Post(':id/revoke')
  @RequirePermission('manage', 'device-token')
  @SystemAudit({
    name: '撤销 Device Token',
    action: 'revoke',
    subject: 'device-token',
    targetType: 'device-token',
    targetParameter: 'id',
    targetNameField: 'name',
  })
  @ApiOperation({ summary: '撤销 device token' })
  revoke(@Param('id', ParseIntPipe) deviceTokenId: number) {
    return this.tokens.revoke(deviceTokenId);
  }

  @Delete(':id')
  @RequirePermission('manage', 'device-token')
  @SystemAudit({
    name: '删除 Device Token',
    action: 'delete',
    subject: 'device-token',
    targetType: 'device-token',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除 device token(软删,与撤销正交)' })
  delete(@Param('id', ParseIntPipe) deviceTokenId: number) {
    return this.tokens.delete(deviceTokenId);
  }
}
