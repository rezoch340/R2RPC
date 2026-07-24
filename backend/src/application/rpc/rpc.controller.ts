import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemAudit } from '../../common/decorators/system-audit.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import type { AuthedRequest } from '../../common/types/authed-request';
import { ProjectsService } from '../projects/projects.service';
import { RequestLogsService } from '../request-logs/request-logs.service';
import { PresenceService } from '../../infrastructure/ws/presence.service';
import { InvokeDto } from './dto/invoke.dto';
import { QueryRpcDebugOptionsDto } from './dto/query-rpc-debug-options.dto';
import { RpcService } from './rpc.service';

@ApiTags('rpc')
@Controller()
export class RpcController {
  constructor(
    private readonly rpcService: RpcService,
    private readonly presenceService: PresenceService,
    private readonly projectsService: ProjectsService,
    private readonly requestLogsService: RequestLogsService,
  ) {}

  @Get('rpc/debug/options')
  @ApiBearerAuth('adminJwt')
  @RequirePermission('invoke', 'manual-rpc')
  @SystemAudit({
    name: '读取手动 RPC 调试上下文',
    action: 'read',
    subject: 'manual-rpc',
    targetType: 'rpc-debugger',
    metadataQueryFields: ['project'],
  })
  @ApiOperation({ summary: '手动 RPC 调试可选功能组、历史 action 与在线设备' })
  async debugOptions(@Query() query: QueryRpcDebugOptionsDto) {
    const projectRecords = await this.projectsService.list();
    const selectedProject = projectRecords.find(
      (projectRecord) => projectRecord.name === query.project,
    );
    if (!selectedProject) {
      return {
        projects: projectRecords,
        actions: [],
        clientIds: [],
      };
    }
    const [onlineClientIds, requestOptions] = await Promise.all([
      this.presenceService.listOnline(selectedProject.id),
      this.requestLogsService.filterOptions({ project: selectedProject.name }),
    ]);
    return {
      projects: projectRecords,
      actions: requestOptions.actions,
      clientIds: onlineClientIds.sort((firstClientId, secondClientId) =>
        firstClientId.localeCompare(secondClientId),
      ),
    };
  }

  @Post('rpc/debug/invoke/:project/:action')
  @HttpCode(200)
  @ApiBearerAuth('adminJwt')
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: '可选目标设备 ID；省略时在功能组在线设备中轮询。',
  })
  @RequirePermission('invoke', 'manual-rpc')
  @SystemAudit({
    name: '手动发起 RPC 调试调用',
    action: 'invoke',
    subject: 'manual-rpc',
    targetType: 'rpc-debugger',
    targetParameter: 'project',
    metadataParameters: ['project', 'action'],
    metadataQueryFields: ['clientId'],
    metadataBodyFields: ['timeoutSeconds'],
  })
  @ApiOperation({ summary: '使用后台权限手动发起 RPC 调试调用' })
  debugInvoke(
    @Param('project') project: string,
    @Param('action') action: string,
    @Body() input: InvokeDto,
    @Query('clientId') clientId: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    return this.rpcService.invoke({
      project,
      action,
      payload: input.payload,
      timeoutSeconds: input.timeoutSeconds,
      clientId,
      requesterUserId: request.user!.id,
    });
  }

  // invoke 走独立 access token 体系(非用户 JWT/RBAC):@Public 跳过全局 JwtAuthGuard/PermissionGuard,
  // 改由 AccessTokenGuard 校验 token 有效性 + :project 作用域,并把 token 信息挂到 req.accessToken
  @Post('rpc/invoke/:project/:action')
  @Public()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('accessToken')
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: '可选目标设备 ID；省略时在功能组在线设备中轮询。',
  })
  @ApiOperation({
    summary: '调用 project 内在线设备执行 action(可选 ?clientId 指定设备)',
  })
  invoke(
    @Param('project') project: string,
    @Param('action') action: string,
    @Body() input: InvokeDto,
    @Query('clientId') clientId: string | undefined,
    @Req() request: { accessToken?: { id: number } },
  ) {
    return this.rpcService.invoke({
      project,
      action,
      payload: input.payload,
      timeoutSeconds: input.timeoutSeconds,
      clientId,
      accessTokenId: request.accessToken?.id,
    });
  }

  @Get('rpc/clientQueue')
  @Public()
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('accessToken')
  @ApiQuery({
    name: 'clientId',
    required: false,
    type: String,
    description: '可选设备 ID；提供时只查询该设备在线状态。',
  })
  @ApiOperation({ summary: 'project 内在线设备(或指定 clientId 的在线状态)' })
  async clientQueue(
    @Query('project') project: string,
    @Query('clientId') clientId?: string,
  ) {
    if (clientId) {
      return {
        clientId,
        online: await this.presenceService.isOnline(clientId),
      };
    }
    const projectId = await this.projectsService.idByName(project);
    if (!projectId) {
      return { project, online: [] };
    }
    return {
      project,
      online: await this.presenceService.listOnline(projectId),
    };
  }
}
