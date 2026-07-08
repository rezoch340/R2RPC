import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';
import { users } from '../application/users/users.schema';
import { hashPassword } from '../common/utils/password';

// 种子管理员账号(幂等)。用法: pnpm seed:admin
// 可用环境变量覆盖: ADMIN_USER / ADMIN_PASSWORD
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
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
