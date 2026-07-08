import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';
import { users } from '../application/users/users.schema';
import { groups } from '../application/groups/groups.schema';
import { clients } from '../application/client/client.schema';
import { clientGroups } from '../application/client/client-groups.schema';
import { permissions, rolePermissions, roles } from '../application/rbac/rbac.schema';
import { hashPassword } from '../common/utils/password';

// 种子管理员账号 + demo 分组/设备 + RBAC 基础数据(幂等,可重复执行)。用法: pnpm seed:admin
// 可用环境变量覆盖: ADMIN_USER / ADMIN_PASSWORD
const DEMO_GROUPS = ['cn-nodes', 'us-nodes'];
const DEMO_CLIENT_ID = 'dev-001';
const DEMO_CLIENT_SECRET = 'secret123';

// 权限全集(action, subject)
const ALL_PERMISSIONS: Array<{ action: string; subject: string }> = [
  { action: 'read', subject: 'user' },
  { action: 'create', subject: 'user' },
  { action: 'delete', subject: 'user' },
  { action: 'read', subject: 'group' },
  { action: 'create', subject: 'group' },
  { action: 'delete', subject: 'group' },
  { action: 'read', subject: 'client' },
  { action: 'create', subject: 'client' },
  { action: 'read', subject: 'metrics' },
  { action: 'read', subject: 'monitor' },
  { action: 'invoke', subject: 'rpc' },
  { action: 'read', subject: 'rpc' },
  { action: 'manage', subject: 'rbac' },
];

// operator 角色只挂 read/* 权限(只读,无 create/delete/invoke/manage)
const OPERATOR_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.action === 'read');

async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';

  await db
    .insert(users)
    .values({ username, passwordHash: hashPassword(password), role: 'admin', isRoot: true })
    .onConflictDoNothing();
  // 若管理员已存在(上面 onConflictDoNothing 跳过),补一次置 root,保证幂等重跑也生效
  await db.update(users).set({ isRoot: true }).where(eq(users.username, username));

  console.log(`管理员已就绪: ${username}(初始密码: ${password}, isRoot: true)`);

  // demo 分组: cn-nodes / us-nodes(幂等)
  await db
    .insert(groups)
    .values(DEMO_GROUPS.map((name) => ({ name })))
    .onConflictDoNothing();
  const groupRows = await db.select().from(groups);
  const groupIdByName = new Map(groupRows.map((g) => [g.name, g.id]));

  // demo 设备账号 dev-001(secret: secret123),关联 cn-nodes + us-nodes(演示多组设备)
  await db
    .insert(clients)
    .values({ clientId: DEMO_CLIENT_ID, secretHash: hashPassword(DEMO_CLIENT_SECRET) })
    .onConflictDoNothing();
  const [device] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.clientId, DEMO_CLIENT_ID))
    .limit(1);

  for (const name of DEMO_GROUPS) {
    const groupId = groupIdByName.get(name);
    if (!groupId) continue;
    await db
      .insert(clientGroups)
      .values({ clientId: device.id, groupId })
      .onConflictDoNothing();
  }

  console.log(
    `demo 设备已就绪: ${DEMO_CLIENT_ID}(secret: ${DEMO_CLIENT_SECRET}, 组: ${DEMO_GROUPS.join(', ')})`,
  );

  // 权限全集(幂等,唯一约束 action+subject)
  await db.insert(permissions).values(ALL_PERMISSIONS).onConflictDoNothing();
  const permRows = await db.select().from(permissions);
  const permIdByKey = new Map(permRows.map((p) => [`${p.action}:${p.subject}`, p.id]));

  // operator 角色(幂等)
  await db
    .insert(roles)
    .values({ name: 'operator', description: '只读角色:仅拥有 read/* 权限' })
    .onConflictDoNothing();
  const [operatorRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'operator'))
    .limit(1);

  // operator 挂 read/* 权限(幂等)
  for (const p of OPERATOR_PERMISSIONS) {
    const permissionId = permIdByKey.get(`${p.action}:${p.subject}`);
    if (!operatorRole || !permissionId) continue;
    await db
      .insert(rolePermissions)
      .values({ roleId: operatorRole.id, permissionId })
      .onConflictDoNothing();
  }

  console.log(
    `RBAC 已就绪: 权限 ${permRows.length} 条, operator 角色挂 read/* 共 ${OPERATOR_PERMISSIONS.length} 条`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
