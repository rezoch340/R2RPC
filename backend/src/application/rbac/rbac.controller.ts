import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseEntityIdPipe } from '../../common/pipes/parse-entity-id.pipe';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemAudit } from '../../common/decorators/system-audit.decorator';
import { RootGuard } from '../../common/guards/root.guard';
import type { AuthedRequest } from '../../common/types/authed-request';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AttachPermissionDto } from './dto/attach-permission.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import {
  QueryPermissionGroupsDto,
  QueryPermissionsDto,
} from './dto/query-rbac.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RbacService } from './rbac.service';

@ApiTags('rbac')
@ApiBearerAuth('adminJwt')
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  // ---------- 权限组管理 ----------

  @Post('roles')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '创建权限组',
    action: 'create',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetNameField: 'name',
    targetResponseField: 'id',
  })
  @ApiOperation({ summary: '创建权限组(仅种子管理员)' })
  createRole(@Body() input: CreateRoleDto) {
    return this.rbacService.createRole(input.name, input.description);
  }

  @Patch('roles/:id')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '编辑权限组',
    action: 'update',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetParameter: 'id',
    targetNameField: 'name',
  })
  @ApiOperation({ summary: '编辑权限组(仅种子管理员)' })
  updateRole(
    @Param('id', ParseEntityIdPipe) roleId: number,
    @Body() input: UpdateRoleDto,
  ) {
    return this.rbacService.updateRole(roleId, input);
  }

  @Get('roles')
  @RequirePermission('read', 'rbac')
  @ApiOperation({ summary: '权限组列表(分页,包含权限)' })
  listRoles(@Query() query: QueryPermissionGroupsDto) {
    return this.rbacService.listRoles(query);
  }

  // 下拉选项源:全量、不分页。用户页的权限组选择器要能选到全部
  @Get('roles/options')
  @RequirePermission('read', 'rbac')
  @ApiOperation({ summary: '权限组下拉选项(全量,不分页)' })
  listRoleOptions() {
    return this.rbacService.listRoleOptions();
  }

  @Delete('roles/:id')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '删除权限组',
    action: 'delete',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除权限组(仅种子管理员)' })
  deleteRole(@Param('id', ParseEntityIdPipe) roleId: number) {
    return this.rbacService.deleteRole(roleId);
  }

  // ---------- 权限管理 ----------

  @Post('permissions')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '创建权限',
    action: 'create',
    subject: 'rbac-permission',
    targetType: 'permission',
    targetResponseField: 'id',
    metadataBodyFields: ['action', 'subject'],
  })
  @ApiOperation({ summary: '创建权限(仅种子管理员)' })
  createPermission(@Body() input: CreatePermissionDto) {
    return this.rbacService.createPermission(
      input.action,
      input.subject,
      input.description,
    );
  }

  @Get('permissions')
  @RequirePermission('read', 'rbac')
  @ApiOperation({ summary: '权限目录列表(分页)' })
  listPermissions(@Query() query: QueryPermissionsDto) {
    return this.rbacService.listPermissions(query);
  }

  // 勾选源:全量、不分页。权限组编辑弹窗要列出整个权限目录供勾选
  @Get('permissions/options')
  @RequirePermission('read', 'rbac')
  @ApiOperation({ summary: '权限目录全量(不分页,供勾选)' })
  listPermissionOptions() {
    return this.rbacService.listPermissionOptions();
  }

  @Delete('permissions/:id')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '删除权限',
    action: 'delete',
    subject: 'rbac-permission',
    targetType: 'permission',
    targetParameter: 'id',
  })
  @ApiOperation({ summary: '删除权限(仅种子管理员)' })
  deletePermission(@Param('id', ParseEntityIdPipe) permissionId: number) {
    return this.rbacService.deletePermission(permissionId);
  }

  // ---------- 权限组 <-> 权限 ----------

  @Post('roles/:roleId/permissions')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '配置权限组权限',
    action: 'attach-permission',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetParameter: 'roleId',
    metadataBodyFields: ['permissionId'],
  })
  @ApiOperation({ summary: '权限组配置权限(请求体形式,仅种子管理员)' })
  attachPermissionFromBody(
    @Param('roleId', ParseEntityIdPipe) roleId: number,
    @Body() input: AttachPermissionDto,
  ) {
    return this.rbacService.attachPermission(roleId, input.permissionId);
  }

  @Post('roles/:roleId/permissions/:permissionId')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '配置权限组权限',
    action: 'attach-permission',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetParameter: 'roleId',
    metadataParameters: ['permissionId'],
  })
  @ApiOperation({ summary: '权限组配置权限(兼容 URL 形式,仅种子管理员)' })
  attachPermission(
    @Param('roleId', ParseEntityIdPipe) roleId: number,
    @Param('permissionId', ParseEntityIdPipe) permissionId: number,
  ) {
    return this.rbacService.attachPermission(roleId, permissionId);
  }

  @Delete('roles/:roleId/permissions/:permissionId')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '移除权限组权限',
    action: 'detach-permission',
    subject: 'rbac-role',
    targetType: 'permission-group',
    targetParameter: 'roleId',
    metadataParameters: ['permissionId'],
  })
  @ApiOperation({ summary: '权限组移除权限(仅种子管理员)' })
  detachPermission(
    @Param('roleId', ParseEntityIdPipe) roleId: number,
    @Param('permissionId', ParseEntityIdPipe) permissionId: number,
  ) {
    return this.rbacService.detachPermission(roleId, permissionId);
  }

  // ---------- 用户 <-> 权限组 ----------

  @Get('users/:userId/roles')
  @RequirePermission('read', 'rbac')
  @ApiOperation({ summary: '用户已分配的权限组' })
  listUserRoles(@Param('userId', ParseEntityIdPipe) userId: number) {
    return this.rbacService.listUserRoles(userId);
  }

  @Post('users/:userId/roles')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '分配用户权限组',
    action: 'assign-role',
    subject: 'rbac-user-role',
    targetType: 'user',
    targetParameter: 'userId',
    metadataBodyFields: ['roleId'],
  })
  @ApiOperation({ summary: '用户分配权限组(请求体形式,仅种子管理员)' })
  assignRoleFromBody(
    @Param('userId', ParseEntityIdPipe) userId: number,
    @Body() input: AssignRoleDto,
    @Req() request: AuthedRequest,
  ) {
    return this.rbacService.assignRole(request.user!.id, userId, input.roleId);
  }

  @Post('users/:userId/roles/:roleId')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '分配用户权限组',
    action: 'assign-role',
    subject: 'rbac-user-role',
    targetType: 'user',
    targetParameter: 'userId',
    metadataParameters: ['roleId'],
  })
  @ApiOperation({ summary: '用户分配权限组(兼容 URL 形式,仅种子管理员)' })
  assignRole(
    @Param('userId', ParseEntityIdPipe) userId: number,
    @Param('roleId', ParseEntityIdPipe) roleId: number,
    @Req() request: AuthedRequest,
  ) {
    return this.rbacService.assignRole(request.user!.id, userId, roleId);
  }

  @Delete('users/:userId/roles/:roleId')
  @UseGuards(RootGuard)
  @RequirePermission('manage', 'rbac')
  @SystemAudit({
    name: '移除用户权限组',
    action: 'unassign-role',
    subject: 'rbac-user-role',
    targetType: 'user',
    targetParameter: 'userId',
    metadataParameters: ['roleId'],
  })
  @ApiOperation({ summary: '用户移除权限组(仅种子管理员)' })
  unassignRole(
    @Param('userId', ParseEntityIdPipe) userId: number,
    @Param('roleId', ParseEntityIdPipe) roleId: number,
    @Req() request: AuthedRequest,
  ) {
    return this.rbacService.unassignRole(request.user!.id, userId, roleId);
  }
}
