import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { SetEnabledDto } from './dto/set-enabled.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('read', 'user')
  @ApiOperation({ summary: '用户列表' })
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermission('read', 'user')
  @ApiOperation({ summary: '用户详情' })
  findOne(@Param('id', ParseIntPipe) userId: number) {
    return this.users.findById(userId);
  }

  @Post()
  @RequirePermission('create', 'user')
  @ApiOperation({ summary: '创建用户' })
  create(@Body() input: CreateUserDto) {
    return this.users.create(input);
  }

  @Delete(':id')
  @RequirePermission('delete', 'user')
  @ApiOperation({ summary: '删除用户' })
  remove(@Param('id', ParseIntPipe) userId: number) {
    return this.users.remove(userId);
  }

  @Post(':id/enabled')
  @RequirePermission('update', 'user')
  @ApiOperation({ summary: '启用/停用用户(停用后禁止登录且立即吊销现有会话)' })
  setEnabled(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: SetEnabledDto,
  ) {
    return this.users.setEnabled(userId, input.enabled);
  }
}
