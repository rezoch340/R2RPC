import { defineConfig, devices } from '@playwright/test';

const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '3001';
const reuseExistingServer =
  process.env.E2E_REUSE_EXISTING_SERVER === 'true';

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
    command: `NEXT_PUBLIC_API_URL=${apiUrl} pnpm next dev -p ${frontendPort}`,
    url: `http://127.0.0.1:${frontendPort}/login`,
    reuseExistingServer,
    timeout: 60_000,
  },
});
