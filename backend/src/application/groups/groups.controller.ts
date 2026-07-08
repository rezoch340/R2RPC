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
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @RequirePermission('read', 'group')
  @ApiOperation({ summary: '分组列表' })
  list() {
    return this.groups.list();
  }

  @Post()
  @RequirePermission('create', 'group')
  @ApiOperation({ summary: '创建分组' })
  create(@Body() dto: CreateGroupDto) {
    return this.groups.create(dto.name);
  }

  @Delete(':id')
  @RequirePermission('delete', 'group')
  @ApiOperation({ summary: '删除分组' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(id);
  }
}
