import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const frontendPort = process.env.E2E_FRONTEND_PORT ?? '3001';
const reuseExistingServer =
  process.env.E2E_REUSE_EXISTING_SERVER === 'true';
const applicationConfigurationFile =
  process.env.CONFIG_FILE ?? resolve(process.cwd(), '../config.yaml');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `CONFIG_FILE=${JSON.stringify(applicationConfigurationFile)} pnpm next dev -p ${frontendPort}`,
    url: `http://127.0.0.1:${frontendPort}/login`,
    reuseExistingServer,
    timeout: 60_000,
  },
});
