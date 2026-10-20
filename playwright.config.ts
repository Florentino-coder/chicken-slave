import { defineConfig, devices } from '@playwright/test';

const PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // The web app must already be built (`npm run build`); the server serves apps/web/dist.
    command: 'npx tsx apps/server/src/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      BOT_DELAY_MS: '150',
      // Long enough for the 4-player test to inspect the round summary overlay.
      NEXT_ROUND_MS: '4000',
      QUICK_WAIT_MS: '1500',
      GRACE_MS: '60000',
      GUEST_PER_MINUTE: '1000',
    },
  },
});
