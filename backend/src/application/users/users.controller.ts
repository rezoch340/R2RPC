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
import { CreateUserDto } from './dto/create-user.dto';
import { SetEnabledDto } from './dto/set-enabled.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('read', 'user')
  @ApiOperation({ summary: '用户列表' })
  list() {
    return this.usersService.list();
  }

  @Get(':id')
  @RequirePermission('read', 'user')
  @ApiOperation({ summary: '用户详情' })
  findOne(@Param('id', ParseIntPipe) userId: number) {
    return this.usersService.findById(userId);
  }

  @Post()
  @RequirePermission('create', 'user')
  @SystemAudit({
    name: '创建用户',
    action: 'create',
    subject: 'user',
    targetType: 'user',
    targetNameField: 'username',
    targetResponseField: 'id',
    metadataBodyFields: ['role'],
  })
  @ApiOperation({ summary: '创建用户' })
  create(@Body() input: CreateUserDto) {
    return this.usersService.create(input);
  }

  @Patch(':id')
  @RequirePermission('update', 'user')
  @SystemAudit({
    name: '修改用户资料',
    action: 'update',
    subject: 'user',
    targetType: 'user',
    targetParameter: 'id',
    targetNameField: 'username',
  })
  @ApiOperation({ summary: '修改用户资料(管理员账号只能由本人修改)' })
  update(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: UpdateUserDto,
    @Req() request: AuthedRequest,
  ) {
    return this.usersService.update(
      request.user!.id,
      userId,
      input.description,
    );
  }

  @Patch(':id/password')
  @RequirePermission('update', 'user')
  @SystemAudit({
    name: '修改用户密码',
    action: 'update-password',
    subject: 'user',
    targetType: 'user',
    targetParameter: 'id',
    targetNameField: 'username',
  })
  @ApiOperation({ summary: '修改用户密码(管理员账号只能由本人修改)' })
  setPassword(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: UpdatePasswordDto,
    @Req() request: AuthedRequest,
  ) {
    return this.usersService.setPassword(
      request.user!.id,
      userId,
      input.password,
    );
  }

  @Delete(':id')
  @RequirePermission('delete', 'user')
  @SystemAudit({
    name: '删除用户',
    action: 'delete',
    subject: 'user',
    targetType: 'user',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除用户(管理员账号只能由本人修改)' })
  remove(
    @Param('id', ParseIntPipe) userId: number,
    @Req() request: AuthedRequest,
  ) {
    return this.usersService.remove(request.user!.id, userId);
  }

  @Post(':id/enabled')
  @RequirePermission('update', 'user')
  @SystemAudit({
    name: '设置用户启用状态',
    action: 'set-enabled',
    subject: 'user',
    targetType: 'user',
    targetParameter: 'id',
    targetNameField: 'username',
    metadataBodyFields: ['enabled'],
  })
  @ApiOperation({ summary: '启用/停用用户(停用后禁止登录且立即吊销现有会话)' })
  setEnabled(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: SetEnabledDto,
    @Req() request: AuthedRequest,
  ) {
    return this.usersService.setEnabled(
      request.user!.id,
      userId,
      input.enabled,
    );
  }
}
