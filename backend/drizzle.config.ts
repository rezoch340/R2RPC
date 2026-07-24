import { defineConfig } from 'drizzle-kit';
import { loadApplicationConfiguration } from './src/infrastructure/config/config.loader';

// drizzle-kit 独立进程使用和 API/Worker 相同的统一配置加载器。
const configuration = loadApplicationConfiguration().configuration;

export default defineConfig({
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: configuration.db,
});
