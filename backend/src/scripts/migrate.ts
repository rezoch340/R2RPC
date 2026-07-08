import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';

// 应用 drizzle/ 下的迁移到 Postgres。编程式 migrator:可靠、幂等、独立步骤(不在 app 启动里跑)。
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('迁移完成');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
