import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { GroupsService } from '../groups/groups.service';
import { PresenceService } from '../../infrastructure/ws/presence.service';
import { InvokeDto } from './dto/invoke.dto';
import { RpcService } from './rpc.service';

@ApiTags('rpc')
@ApiBearerAuth()
@Controller()
export class RpcController {
  constructor(
    private readonly rpc: RpcService,
    private readonly presence: PresenceService,
    private readonly groups: GroupsService,
  ) {}

  @Post('rpc/invoke/:group/:action')
  @RequirePermission('invoke', 'rpc')
  @ApiOperation({
    summary: '调用 group 内在线设备执行 action(可选 ?clientId 指定设备)',
  })
  invoke(
    @Param('group') group: string,
    @Param('action') action: string,
    @Body() dto: InvokeDto,
    @Query('clientId') clientId: string | undefined,
    @Req() req: { user?: { sub?: number | string } },
  ) {
    return this.rpc.invoke({
      group,
      action,
      payload: dto.payload,
      timeoutSeconds: dto.timeoutSeconds,
      clientId,
      requesterUserId: req.user?.sub,
    });
  }

  @Get('rpc/clientQueue')
  @RequirePermission('read', 'rpc')
  @ApiOperation({ summary: 'group 内在线设备(或指定 clientId 的在线状态)' })
  async clientQueue(
    @Query('group') group: string,
    @Query('clientId') clientId?: string,
  ) {
    if (clientId) {
      return { clientId, online: await this.presence.isOnline(clientId) };
    }
    const groupId = await this.groups.idByName(group);
    if (!groupId) return { group, online: [] };
    return { group, online: await this.presence.listOnline(groupId) };
  }
}
