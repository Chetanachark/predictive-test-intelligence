import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const externalURL = process.env.BASE_URL
const localURL = 'http://127.0.0.1:5174'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: './reports/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './reports/html', open: 'never' }],
  ],
  use: {
    baseURL: externalURL || localURL,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalURL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174',
    cwd: fileURLToPath(new URL('../frontend', import.meta.url)),
    url: localURL,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})
