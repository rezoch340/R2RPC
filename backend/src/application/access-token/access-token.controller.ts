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
import { AccessTokenService } from './access-token.service';
import { CreateAccessTokenDto } from './dto/create-access-token.dto';
import { UpdateAccessTokenDto } from './dto/update-access-token.dto';
import { UpdateAccessTokenProjectsDto } from './dto/update-access-token-projects.dto';

@ApiTags('access-token')
@ApiBearerAuth('adminJwt')
@Controller('access-tokens')
export class AccessTokenController {
  constructor(private readonly tokens: AccessTokenService) {}

  // 生成 access token
  @Post()
  @RequirePermission('manage', 'access-token')
  @SystemAudit({
    name: '创建 Access Token',
    action: 'create',
    subject: 'access-token',
    targetType: 'access-token',
    targetNameField: 'name',
    targetResponseField: 'id',
    metadataBodyFields: ['projects', 'expiresAt', 'maximumUsageCount'],
  })
  @ApiOperation({ summary: '生成 access token(返回明文)' })
  create(@Body() input: CreateAccessTokenDto, @Req() request: AuthedRequest) {
    return this.tokens.create({
      name: input.name,
      projects: input.projects,
      description: input.description,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      maximumUsageCount: input.maximumUsageCount,
      createdBy: request.user?.id,
    });
  }

  // 列表:所有 token(包含明文,后台可回看)
  @Get()
  @RequirePermission('manage', 'access-token')
  @ApiOperation({ summary: '列表:所有 access token(含明文、project 名)' })
  list() {
    return this.tokens.list();
  }

  @Patch(':id')
  @RequirePermission('manage', 'access-token')
  @SystemAudit({
    name: '修改 Access Token',
    action: 'update',
    subject: 'access-token',
    targetType: 'access-token',
    targetParameter: 'id',
    metadataBodyFields: ['projects', 'expiresAt', 'maximumUsageCount'],
  })
  @ApiOperation({ summary: '修改 access token 的功能组与过期策略' })
  update(
    @Param('id', ParseIntPipe) accessTokenId: number,
    @Body() input: UpdateAccessTokenDto,
  ) {
    return this.tokens.update(accessTokenId, {
      projects: input.projects,
      expiresAt:
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt),
      maximumUsageCount: input.maximumUsageCount,
    });
  }

  @Patch(':id/projects')
  @RequirePermission('manage', 'access-token')
  @SystemAudit({
    name: '修改 Access Token 功能组',
    action: 'update',
    subject: 'access-token',
    targetType: 'access-token',
    targetParameter: 'id',
    metadataBodyFields: ['projects'],
  })
  @ApiOperation({ summary: '替换 access token 的功能组作用域' })
  updateProjects(
    @Param('id', ParseIntPipe) accessTokenId: number,
    @Body() input: UpdateAccessTokenProjectsDto,
  ) {
    return this.tokens.updateProjects(accessTokenId, input.projects);
  }

  // 撤销 token
  @Post(':id/revoke')
  @RequirePermission('manage', 'access-token')
  @SystemAudit({
    name: '撤销 Access Token',
    action: 'revoke',
    subject: 'access-token',
    targetType: 'access-token',
    targetParameter: 'id',
    targetNameField: 'name',
  })
  @ApiOperation({ summary: '撤销 access token' })
  revoke(@Param('id', ParseIntPipe) accessTokenId: number) {
    return this.tokens.revoke(accessTokenId);
  }

  // 删除 token(软删,与撤销正交)
  @Delete(':id')
  @RequirePermission('manage', 'access-token')
  @SystemAudit({
    name: '删除 Access Token',
    action: 'delete',
    subject: 'access-token',
    targetType: 'access-token',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除 access token(软删,与撤销正交)' })
  delete(@Param('id', ParseIntPipe) accessTokenId: number) {
    return this.tokens.delete(accessTokenId);
  }
}
