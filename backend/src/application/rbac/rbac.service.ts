import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import { and, eq, inArray } from 'drizzle-orm';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { UserAuthorizationCacheService } from '../../infrastructure/redis/user-authorization-cache.service';
import { AdministratorAccountPolicyService } from '../users/administrator-account-policy.service';
import { users } from '../users/users.schema';
import { permissions, rolePermissions, roles, userRoles } from './rbac.schema';
import {
  PermissionGroup,
  PermissionGroupPermission,
  PermissionTuple,
} from './entity/model';

const permissionGroupSelection = {
  id: roles.id,
  name: roles.name,
  description: roles.description,
  createdAt: roles.createdAt,
};

interface PermissionGroupRecord {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
}

type PermissionGroupPermissionRecord = PermissionGroupPermission & {
  roleId: number;
};

function hasDatabaseErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === expectedCode
  );
}

@Injectable()
export class RbacService {
  constructor(
    private readonly dbService: DbService,
    private readonly administratorAccountPolicyService: AdministratorAccountPolicyService,
    private readonly userAuthorizationCacheService: UserAuthorizationCacheService,
  ) {}

  private get database() {
    return this.dbService.database;
  }

  // ---------- 鉴权查询(JwtStrategy/PermissionGuard 消费) ----------

  // 查用户的全部有效权限:user_roles → role_permissions → permissions,按 action+subject 去重
  async getUserPermissions(userId: number): Promise<PermissionTuple[]> {
    return (
      this.database
        .selectDistinct({
          action: permissions.action,
          subject: permissions.subject,
        })
        .from(userRoles)
        // join ON 经 alive 过滤软删角色 / 软删权限——关联行不 cascade,不过滤会"读到已删授权"
        .innerJoin(roles, alive(roles, eq(userRoles.roleId, roles.id)))
        .innerJoin(
          rolePermissions,
          eq(userRoles.roleId, rolePermissions.roleId),
        )
        .innerJoin(
          permissions,
          alive(permissions, eq(rolePermissions.permissionId, permissions.id)),
        )
        .where(eq(userRoles.userId, userId))
    );
  }

  // 查用户身份(id + 是否 root + 是否启用),过滤软删——已删用户视为不存在,JwtStrategy 据此拒绝其 JWT
  async findAuthUser(
    userId: number,
  ): Promise<{ id: number; isRoot: boolean; enabled: boolean } | null> {
    const [user] = await this.database
      .select({ id: users.id, isRoot: users.isRoot, enabled: users.enabled })
      .from(users)
      .where(alive(users, eq(users.id, userId)))
      .limit(1);
    return user ?? null;
  }

  // 用权限元组构建 CASL ability,供 PermissionGuard 做 can(action, subject) 判断
  buildAbility(permissionTuples: PermissionTuple[]): MongoAbility {
    const { can: allow, build } = new AbilityBuilder<MongoAbility>(
      createMongoAbility,
    );
    for (const permission of permissionTuples) {
      allow(permission.action, permission.subject);
    }
    return build();
  }

  // ---------- 权限组 CRUD ----------

  async createRole(name: string, description?: string) {
    const [createdRole] = await this.database
      .insert(roles)
      .values({ name, description })
      .onConflictDoNothing()
      .returning(permissionGroupSelection);
    if (!createdRole) {
      throw new ConflictException('权限组已存在');
    }
    return { ...createdRole, permissions: [] };
  }

  async listRoles() {
    const roleRecords = await this.database
      .select(permissionGroupSelection)
      .from(roles)
      .where(alive(roles))
      .orderBy(roles.id);
    return this.includePermissions(roleRecords);
  }

  async updateRole(
    roleId: number,
    input: { name?: string; description?: string },
  ) {
    const updateValues = this.buildRoleUpdateValues(input);
    let updatedRole: PermissionGroupRecord | undefined;
    try {
      [updatedRole] = await this.database
        .update(roles)
        .set(updateValues)
        .where(alive(roles, eq(roles.id, roleId)))
        .returning(permissionGroupSelection);
    } catch (error) {
      this.rethrowRoleUpdateError(error);
    }
    if (!updatedRole) {
      throw new NotFoundException('权限组不存在');
    }
    const [roleResponse] = await this.includePermissions([updatedRole]);
    return roleResponse;
  }

  async deleteRole(roleId: number) {
    const affectedUserIds = await this.listRoleMemberUserIds(roleId);
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [deletedRole] = await softDelete(
        this.database,
        roles,
        eq(roles.id, roleId),
      );
      if (!deletedRole) {
        throw new NotFoundException('权限组不存在');
      }
      return { deleted: true };
    }, affectedUserIds);
  }

  // ---------- 权限 CRUD ----------

  // description 可选(权限表新增的说明列),不传则为 null
  async createPermission(
    action: string,
    subject: string,
    description?: string,
  ) {
    const [createdPermission] = await this.database
      .insert(permissions)
      .values({ action, subject, description })
      .onConflictDoNothing()
      .returning();
    if (!createdPermission) {
      throw new ConflictException('权限已存在');
    }
    return createdPermission;
  }

  async listPermissions() {
    return this.database
      .select()
      .from(permissions)
      .where(alive(permissions))
      .orderBy(permissions.id);
  }

  async deletePermission(permissionId: number) {
    const affectedUserIds =
      await this.listPermissionHolderUserIds(permissionId);
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [deletedPermission] = await softDelete(
        this.database,
        permissions,
        eq(permissions.id, permissionId),
      );
      if (!deletedPermission) {
        throw new NotFoundException('权限不存在');
      }
      return { deleted: true };
    }, affectedUserIds);
  }

  // ---------- 权限组 <-> 权限 ----------

  async attachPermission(roleId: number, permissionId: number) {
    await this.assertRoleExists(roleId);
    await this.assertPermissionExists(permissionId);
    const affectedUserIds = await this.listRoleMemberUserIds(roleId);
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [attachedPermission] = await this.database
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing()
        .returning();
      if (!attachedPermission) {
        throw new ConflictException('权限组已拥有该权限');
      }
      return { attached: true };
    }, affectedUserIds);
  }

  async detachPermission(roleId: number, permissionId: number) {
    const affectedUserIds = await this.listRoleMemberUserIds(roleId);
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [detachedPermission] = await this.database
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, roleId),
            eq(rolePermissions.permissionId, permissionId),
          ),
        )
        .returning();
      if (!detachedPermission) {
        throw new NotFoundException('权限组未拥有该权限');
      }
      return { detached: true };
    }, affectedUserIds);
  }

  // ---------- 用户 <-> 权限组 ----------

  async listUserRoles(userId: number) {
    await this.assertUserExists(userId);
    const roleRecords = await this.database
      .select(permissionGroupSelection)
      .from(userRoles)
      .innerJoin(roles, alive(roles, eq(userRoles.roleId, roles.id)))
      .where(eq(userRoles.userId, userId))
      .orderBy(roles.id);
    return this.includePermissions(roleRecords);
  }

  async assignRole(
    requesterUserId: number,
    targetUserId: number,
    roleId: number,
  ) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    await this.assertRoleExists(roleId);
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [assignedRole] = await this.database
        .insert(userRoles)
        .values({ userId: targetUserId, roleId })
        .onConflictDoNothing()
        .returning();
      if (!assignedRole) {
        throw new ConflictException('用户已拥有该权限组');
      }
      return { assigned: true };
    }, [targetUserId]);
  }

  async unassignRole(
    requesterUserId: number,
    targetUserId: number,
    roleId: number,
  ) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    return this.userAuthorizationCacheService.writeAndInvalidate(async () => {
      const [unassignedRole] = await this.database
        .delete(userRoles)
        .where(
          and(eq(userRoles.userId, targetUserId), eq(userRoles.roleId, roleId)),
        )
        .returning();
      if (!unassignedRole) {
        throw new NotFoundException('用户未拥有该权限组');
      }
      return { unassigned: true };
    }, [targetUserId]);
  }

  // ---------- 存在性校验(供上面的关联操作复用,不存在则 404) ----------

  private async assertRoleExists(roleId: number) {
    const [role] = await this.database
      .select({ id: roles.id })
      .from(roles)
      .where(alive(roles, eq(roles.id, roleId)))
      .limit(1);
    if (!role) {
      throw new NotFoundException('权限组不存在');
    }
  }

  private async assertPermissionExists(permissionId: number) {
    const [permission] = await this.database
      .select({ id: permissions.id })
      .from(permissions)
      .where(alive(permissions, eq(permissions.id, permissionId)))
      .limit(1);
    if (!permission) {
      throw new NotFoundException('权限不存在');
    }
  }

  private async assertUserExists(userId: number) {
    const [user] = await this.database
      .select({ id: users.id })
      .from(users)
      .where(alive(users, eq(users.id, userId)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
  }

  private buildRoleUpdateValues(input: {
    name?: string;
    description?: string;
  }) {
    const updateValues: { name?: string; description?: string } = {};
    if (input.name !== undefined) {
      updateValues.name = input.name;
    }
    if (input.description !== undefined) {
      updateValues.description = input.description;
    }
    if (Object.keys(updateValues).length === 0) {
      throw new BadRequestException('至少提供 name 或 description');
    }
    return updateValues;
  }

  private rethrowRoleUpdateError(error: unknown): never {
    if (hasDatabaseErrorCode(error, '23505')) {
      throw new ConflictException('权限组已存在');
    }
    throw error;
  }

  private async includePermissions(
    roleRecords: PermissionGroupRecord[],
  ): Promise<PermissionGroup[]> {
    const permissionRecords = await this.listRolePermissionRecords(
      roleRecords.map((roleRecord) => roleRecord.id),
    );
    const permissionsByRoleId = new Map<number, PermissionGroupPermission[]>();
    for (const permissionRecord of permissionRecords) {
      const { roleId, ...permission } = permissionRecord;
      const rolePermissionList = permissionsByRoleId.get(roleId) ?? [];
      rolePermissionList.push(permission);
      permissionsByRoleId.set(roleId, rolePermissionList);
    }
    return roleRecords.map((roleRecord) => ({
      ...roleRecord,
      permissions: permissionsByRoleId.get(roleRecord.id) ?? [],
    }));
  }

  private async listRolePermissionRecords(
    roleIds: number[],
  ): Promise<PermissionGroupPermissionRecord[]> {
    if (roleIds.length === 0) {
      return [];
    }
    return this.database
      .select({
        roleId: rolePermissions.roleId,
        id: permissions.id,
        action: permissions.action,
        subject: permissions.subject,
        description: permissions.description,
      })
      .from(rolePermissions)
      .innerJoin(
        permissions,
        alive(permissions, eq(rolePermissions.permissionId, permissions.id)),
      )
      .where(inArray(rolePermissions.roleId, roleIds))
      .orderBy(rolePermissions.roleId, permissions.id);
  }

  private async listRoleMemberUserIds(roleId: number): Promise<number[]> {
    const userRecords = await this.database
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    return userRecords.map((userRecord) => userRecord.userId);
  }

  private async listPermissionHolderUserIds(
    permissionId: number,
  ): Promise<number[]> {
    const userRecords = await this.database
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .where(eq(rolePermissions.permissionId, permissionId));
    return userRecords.map((userRecord) => userRecord.userId);
  }
}
