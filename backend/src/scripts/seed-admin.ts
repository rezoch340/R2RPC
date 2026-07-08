import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';
import { users } from '../application/users/users.schema';
import { groups } from '../application/groups/groups.schema';
import { clients } from '../application/client/client.schema';
import { clientGroups } from '../application/client/client-groups.schema';
import { hashPassword } from '../common/utils/password';

// 种子管理员账号 + demo 分组/设备(幂等,可重复执行)。用法: pnpm seed:admin
// 可用环境变量覆盖: ADMIN_USER / ADMIN_PASSWORD
const DEMO_GROUPS = ['cn-nodes', 'us-nodes'];
const DEMO_CLIENT_ID = 'dev-001';
const DEMO_CLIENT_SECRET = 'secret123';

async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';

  await db
    .insert(users)
    .values({ username, passwordHash: hashPassword(password), role: 'admin' })
    .onConflictDoNothing();

  console.log(`管理员已就绪: ${username}(初始密码: ${password})`);

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

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
