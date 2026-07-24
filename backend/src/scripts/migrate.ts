import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';

// 应用 drizzle/ 下的迁移到 Postgres。编程式 migrator:可靠、幂等、独立步骤(不在 app 启动里跑)。
async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool);
  await migrate(database, { migrationsFolder: './drizzle' });
  console.log('迁移完成');
  await connectionPool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
