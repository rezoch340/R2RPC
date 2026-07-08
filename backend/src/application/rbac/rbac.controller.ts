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
import { RbacService } from './rbac.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreatePermissionDto } from './dto/create-permission.dto';

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  // ---------- 角色管理 ----------

  @Post('roles')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '创建角色' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.createRole(dto.name, dto.description);
  }

  @Get('roles')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '列表:所有角色' })
  listRoles() {
    return this.rbac.listRoles();
  }

  @Delete('roles/:id')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '删除角色' })
  deleteRole(@Param('id', ParseIntPipe) id: number) {
    return this.rbac.deleteRole(id);
  }

  // ---------- 权限管理 ----------

  @Post('permissions')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '创建权限' })
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.rbac.createPermission(dto.action, dto.subject, dto.description);
  }

  @Get('permissions')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '列表:所有权限' })
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Delete('permissions/:id')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '删除权限' })
  deletePermission(@Param('id', ParseIntPipe) id: number) {
    return this.rbac.deletePermission(id);
  }

  // ---------- 角色 <-> 权限 ----------

  @Post('roles/:roleId/permissions/:permissionId')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '角色绑定权限' })
  attachPermission(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
  ) {
    return this.rbac.attachPermission(roleId, permissionId);
  }

  @Delete('roles/:roleId/permissions/:permissionId')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '角色移除权限' })
  detachPermission(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
  ) {
    return this.rbac.detachPermission(roleId, permissionId);
  }

  // ---------- 用户 <-> 角色 ----------

  @Post('users/:userId/roles/:roleId')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '用户分配角色' })
  assignRole(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('roleId', ParseIntPipe) roleId: number,
  ) {
    return this.rbac.assignRole(userId, roleId);
  }

  @Delete('users/:userId/roles/:roleId')
  @RequirePermission('manage', 'rbac')
  @ApiOperation({ summary: '用户移除角色' })
  unassignRole(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('roleId', ParseIntPipe) roleId: number,
  ) {
    return this.rbac.unassignRole(userId, roleId);
  }
}
