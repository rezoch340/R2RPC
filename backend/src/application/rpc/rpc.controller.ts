import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { ProjectsService } from '../projects/projects.service';
import { PresenceService } from '../../infrastructure/ws/presence.service';
import { InvokeDto } from './dto/invoke.dto';
import { RpcService } from './rpc.service';

@ApiTags('rpc')
@ApiBearerAuth()
@Controller()
export class RpcController {
  constructor(
    private readonly rpcService: RpcService,
    private readonly presenceService: PresenceService,
    private readonly projectsService: ProjectsService,
  ) {}

  // invoke 走独立 access token 体系(非用户 JWT/RBAC):@Public 跳过全局 JwtAuthGuard/PermissionGuard,
  // 改由 AccessTokenGuard 校验 token 有效性 + :project 作用域,并把 token 信息挂到 req.accessToken
  @Post('rpc/invoke/:project/:action')
  @Public()
  @UseGuards(AccessTokenGuard)
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
