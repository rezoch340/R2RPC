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
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findById(id);
  }

  @Post()
  @RequirePermission('create', 'user')
  @ApiOperation({ summary: '创建用户' })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Delete(':id')
  @RequirePermission('delete', 'user')
  @ApiOperation({ summary: '删除用户' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.users.remove(id);
  }
}
