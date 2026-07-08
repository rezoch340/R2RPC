import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';

// 一次性回填: 旧 clients.group_name 字符串 → groups 行 + client_groups 关联。
// 必须在 "drop group_name" 迁移之前运行(此时列还在)。
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);

  // 建缺失的 group 行
  await db.execute(sql`
    insert into groups (name)
    select distinct group_name from clients
    where group_name is not null
    on conflict (name) do nothing`);

  // 建关联
  await db.execute(sql`
    insert into client_groups (client_id, group_id)
    select c.id, g.id from clients c join groups g on g.name = c.group_name
    on conflict do nothing`);

  console.log('分组回填完成');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
