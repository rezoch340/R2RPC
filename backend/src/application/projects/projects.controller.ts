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
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '功能组列表' })
  list() {
    return this.projects.list();
  }

  @Post()
  @RequirePermission('create', 'project')
  @ApiOperation({ summary: '创建功能组' })
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto.name);
  }

  @Delete(':id')
  @RequirePermission('delete', 'project')
  @ApiOperation({ summary: '删除功能组' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.projects.remove(id);
  }
}
