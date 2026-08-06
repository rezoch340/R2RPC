import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseEntityIdPipe } from '../../common/pipes/parse-entity-id.pipe';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemAudit } from '../../common/decorators/system-audit.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { QueryProjectStatsDto } from './dto/query-project-stats.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { SetEnabledDto } from './dto/set-enabled.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth('adminJwt')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // 下拉选项源:全量返回,不分页。功能组名要供令牌页的筛选与编辑弹窗完整选择,
  // 分了页下拉就只剩第一页。与 /monitor/request-options 同性质。
  @Get()
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '功能组下拉选项(全量,不分页)' })
  list() {
    return this.projects.list();
  }

  @Get('info')
  @RequirePermission('read', 'project')
  @ApiOperation({
    summary: '功能组列表(分页);派生统计另见 GET /projects/stats',
  })
  info(@Query() query: QueryProjectsDto) {
    return this.projects.listPaged(query);
  }

  // 派生统计单列:设备数、近 7 天请求、成功率、运行态都算不进 WHERE,
  // 由列表页拿到当页 id 后二次请求,聚合范围随之收窄到当页
  @Get('stats')
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '按功能组编号取派生统计' })
  stats(@Query() query: QueryProjectStatsDto) {
    return this.projects.statsByIds(query.ids);
  }

  @Get('summary')
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '功能组计数(总数/启用数),供仪表盘' })
  summary() {
    return this.projects.summary();
  }

  @Post()
  @RequirePermission('create', 'project')
  @SystemAudit({
    name: '创建功能组',
    action: 'create',
    subject: 'project',
    targetType: 'project',
    targetNameField: 'name',
    targetResponseField: 'id',
  })
  @ApiOperation({ summary: '创建功能组' })
  create(@Body() input: CreateProjectDto) {
    return this.projects.create(input.name, input.description);
  }

  @Delete(':id')
  @RequirePermission('delete', 'project')
  @SystemAudit({
    name: '删除功能组',
    action: 'delete',
    subject: 'project',
    targetType: 'project',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除功能组' })
  remove(@Param('id', ParseEntityIdPipe) projectId: number) {
    return this.projects.remove(projectId);
  }

  @Post(':id/enabled')
  @RequirePermission('update', 'project')
  @SystemAudit({
    name: '设置功能组启用状态',
    action: 'set-enabled',
    subject: 'project',
    targetType: 'project',
    targetParameter: 'id',
    targetNameField: 'name',
    metadataBodyFields: ['enabled'],
  })
  @ApiOperation({ summary: '启用/停用功能组(停用后 invoke 拒派)' })
  setEnabled(
    @Param('id', ParseEntityIdPipe) projectId: number,
    @Body() input: SetEnabledDto,
  ) {
    return this.projects.setEnabled(projectId, input.enabled);
  }
}
