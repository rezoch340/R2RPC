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
import { SetEnabledDto } from './dto/set-enabled.dto';
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

  @Get('info')
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '功能组派生统计(设备数/在线/近7天/成功率/运行态)' })
  info() {
    return this.projects.groupInfo();
  }

  @Post()
  @RequirePermission('create', 'project')
  @ApiOperation({ summary: '创建功能组' })
  create(@Body() input: CreateProjectDto) {
    return this.projects.create(input.name);
  }

  @Delete(':id')
  @RequirePermission('delete', 'project')
  @ApiOperation({ summary: '删除功能组' })
  remove(@Param('id', ParseIntPipe) projectId: number) {
    return this.projects.remove(projectId);
  }

  @Post(':id/enabled')
  @RequirePermission('update', 'project')
  @ApiOperation({ summary: '启用/停用功能组(停用后 invoke 拒派)' })
  setEnabled(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() input: SetEnabledDto,
  ) {
    return this.projects.setEnabled(projectId, input.enabled);
  }
}
