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
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@Roles('admin')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: '分组列表' })
  list() {
    return this.groups.list();
  }

  @Post()
  @ApiOperation({ summary: '创建分组' })
  create(@Body() dto: CreateGroupDto) {
    return this.groups.create(dto.name);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除分组' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(id);
  }
}
