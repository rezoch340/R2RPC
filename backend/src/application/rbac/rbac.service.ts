import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { users } from '../users/users.schema';
import { permissions, rolePermissions, roles, userRoles } from './rbac.schema';
import { PermissionTuple } from './entity/model';

@Injectable()
export class RbacService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  // ---------- 鉴权查询(JwtStrategy/PermissionGuard 消费) ----------

  // 查用户的全部有效权限:user_roles → role_permissions → permissions,按 action+subject 去重
  async getUserPermissions(userId: number): Promise<PermissionTuple[]> {
    return this.db
      .selectDistinct({ action: permissions.action, subject: permissions.subject })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));
  }

  // 是否 root 用户(root 不受权限表约束,直通)
  async isRoot(userId: number): Promise<boolean> {
    const [u] = await this.db
      .select({ isRoot: users.isRoot })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.isRoot ?? false;
  }

  // 用权限元组构建 CASL ability,供 PermissionGuard 做 can(action, subject) 判断
  buildAbility(perms: PermissionTuple[]): MongoAbility {
    const { can, build } = new AbilityBuilder<MongoAbility>(createMongoAbility);
    for (const p of perms) can(p.action, p.subject);
    return build();
  }

  // ---------- 角色 CRUD ----------

  async createRole(name: string, description?: string) {
    const [row] = await this.db
      .insert(roles)
      .values({ name, description })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('角色已存在');
    return row;
  }

  async listRoles() {
    return this.db.select().from(roles);
  }

  async deleteRole(id: number) {
    const [row] = await this.db.delete(roles).where(eq(roles.id, id)).returning();
    if (!row) throw new NotFoundException('角色不存在');
    return { deleted: true };
  }

  // ---------- 权限 CRUD ----------

  // description 可选(权限表新增的说明列),不传则为 null
  async createPermission(action: string, subject: string, description?: string) {
    const [row] = await this.db
      .insert(permissions)
      .values({ action, subject, description })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('权限已存在');
    return row;
  }

  async listPermissions() {
    return this.db.select().from(permissions);
  }

  async deletePermission(id: number) {
    const [row] = await this.db.delete(permissions).where(eq(permissions.id, id)).returning();
    if (!row) throw new NotFoundException('权限不存在');
    return { deleted: true };
  }

  // ---------- 角色 <-> 权限 ----------

  async attachPermission(roleId: number, permissionId: number) {
    await this.assertRoleExists(roleId);
    await this.assertPermissionExists(permissionId);
    const [row] = await this.db
      .insert(rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('角色已拥有该权限');
    return { attached: true };
  }

  async detachPermission(roleId: number, permissionId: number) {
    const [row] = await this.db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
      .returning();
    if (!row) throw new NotFoundException('角色未拥有该权限');
    return { detached: true };
  }

  // ---------- 用户 <-> 角色 ----------

  async assignRole(userId: number, roleId: number) {
    await this.assertUserExists(userId);
    await this.assertRoleExists(roleId);
    const [row] = await this.db
      .insert(userRoles)
      .values({ userId, roleId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('用户已拥有该角色');
    return { assigned: true };
  }

  async unassignRole(userId: number, roleId: number) {
    const [row] = await this.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning();
    if (!row) throw new NotFoundException('用户未拥有该角色');
    return { unassigned: true };
  }

  // ---------- 存在性校验(供上面的关联操作复用,不存在则 404) ----------

  private async assertRoleExists(id: number) {
    const [row] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
    if (!row) throw new NotFoundException('角色不存在');
  }

  private async assertPermissionExists(id: number) {
    const [row] = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('权限不存在');
  }

  private async assertUserExists(id: number) {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!row) throw new NotFoundException('用户不存在');
  }
}
