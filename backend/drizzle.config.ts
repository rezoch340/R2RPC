import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit 独立进程运行,直接从 config.yaml 读库连接;schema 用 glob 收集所有 *.schema.ts
const cfg = load(
  readFileSync(process.env.CONFIG_FILE || 'config.yaml', 'utf8'),
) as { db: { host: string; port: number; user: string; password: string; database: string } };

export default defineConfig({
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: cfg.db.host,
    port: cfg.db.port,
    user: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.database,
  },
});
