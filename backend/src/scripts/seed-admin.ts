import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';
import { users } from '../application/users/users.schema';
import { projects } from '../application/projects/projects.schema';
import {
  permissions,
  rolePermissions,
  roles,
} from '../application/rbac/rbac.schema';
import { hashPassword } from '../common/utils/password';

// 种子管理员账号 + demo 分组/设备 + RBAC 基础数据(幂等,可重复执行)。用法: pnpm seed:admin
// 可用环境变量覆盖: ADMIN_USER / ADMIN_PASSWORD
const DEMO_PROJECTS = ['cn-nodes', 'us-nodes'];

// 权限全集(action, subject)
const ALL_PERMISSIONS: Array<{ action: string; subject: string }> = [
  { action: 'read', subject: 'user' },
  { action: 'create', subject: 'user' },
  { action: 'delete', subject: 'user' },
  { action: 'update', subject: 'user' },
  { action: 'read', subject: 'project' },
  { action: 'create', subject: 'project' },
  { action: 'delete', subject: 'project' },
  { action: 'update', subject: 'project' },
  { action: 'read', subject: 'metrics' },
  { action: 'read', subject: 'monitor' },
  { action: 'invoke', subject: 'rpc' },
  { action: 'read', subject: 'rpc' },
  { action: 'read', subject: 'rbac' },
  { action: 'manage', subject: 'rbac' },
  { action: 'manage', subject: 'access-token' },
  { action: 'manage', subject: 'device-token' },
  { action: 'read', subject: 'device' },
];

// operator 权限组只挂 read/* 权限(只读,无 create/delete/invoke/manage)
const OPERATOR_PERMISSIONS = ALL_PERMISSIONS.filter(
  (permission) => permission.action === 'read',
);

async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool);

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';

  await database
    .insert(users)
    .values({
      username,
      passwordHash: hashPassword(password),
      role: 'admin',
      isRoot: true,
    })
    .onConflictDoNothing();
  // 若管理员已存在(上面 onConflictDoNothing 跳过),补一次置 root,保证幂等重跑也生效
  await database
    .update(users)
    .set({ isRoot: true })
    .where(eq(users.username, username));

  console.log(`管理员已就绪: ${username}(初始密码: ${password}, isRoot: true)`);

  // demo 功能组: cn-nodes / us-nodes(幂等)
  await database
    .insert(projects)
    .values(DEMO_PROJECTS.map((name) => ({ name })))
    .onConflictDoNothing();
  // 权限全集(幂等,唯一约束 action+subject)
  await database
    .insert(permissions)
    .values(ALL_PERMISSIONS)
    .onConflictDoNothing();
  const permissionRecords = await database.select().from(permissions);
  const permissionIdByKey = new Map(
    permissionRecords.map((permission) => [
      `${permission.action}:${permission.subject}`,
      permission.id,
    ]),
  );

  // operator 权限组(幂等)
  await database
    .insert(roles)
    .values({ name: 'operator', description: '只读权限组:仅拥有 read/* 权限' })
    .onConflictDoNothing();
  const [operatorRole] = await database
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'operator'))
    .limit(1);

  // operator 权限组挂 read/* 权限(幂等)
  for (const permission of OPERATOR_PERMISSIONS) {
    const permissionId = permissionIdByKey.get(
      `${permission.action}:${permission.subject}`,
    );
    if (!operatorRole || !permissionId) {
      continue;
    }
    await database
      .insert(rolePermissions)
      .values({ roleId: operatorRole.id, permissionId })
      .onConflictDoNothing();
  }

  console.log(
    `RBAC 已就绪: 权限 ${permissionRecords.length} 条, operator 权限组挂 read/* 共 ${OPERATOR_PERMISSIONS.length} 条`,
  );

  await connectionPool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
