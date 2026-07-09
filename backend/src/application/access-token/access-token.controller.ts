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
import { AccessTokenService } from './access-token.service';
import { CreateAccessTokenDto } from './dto/create-access-token.dto';

@ApiTags('access-token')
@ApiBearerAuth()
@Controller('access-tokens')
export class AccessTokenController {
  constructor(private readonly tokens: AccessTokenService) {}

  // 生成 access token
  @Post()
  @RequirePermission('manage', 'access-token')
  @ApiOperation({ summary: '生成 access token(返回明文)' })
  create(@Body() dto: CreateAccessTokenDto, @Req() req: AuthedRequest) {
    return this.tokens.create({
      name: dto.name,
      projects: dto.projects,
      description: dto.description,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdBy: req.user?.id,
    });
  }

  // 列表:所有 token(包含明文,后台可回看)
  @Get()
  @RequirePermission('manage', 'access-token')
  @ApiOperation({ summary: '列表:所有 access token(含明文、project 名)' })
  list() {
    return this.tokens.list();
  }

  // 撤销 token
  @Post(':id/revoke')
  @RequirePermission('manage', 'access-token')
  @ApiOperation({ summary: '撤销 access token' })
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.revoke(id);
  }

  // 删除 token(软删,与撤销正交)
  @Delete(':id')
  @RequirePermission('manage', 'access-token')
  @ApiOperation({ summary: '删除 access token(软删,与撤销正交)' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.delete(id);
  }
}
