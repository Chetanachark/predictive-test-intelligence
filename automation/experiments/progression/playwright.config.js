import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../../playwright.config.js'
export default defineConfig({
  ...base, testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: '**/progression.spec.js',
  fullyParallel: false, workers: 1, retries: 1, timeout: 15_000, expect: { timeout: 900 },
  outputDir: fileURLToPath(new URL('../../reports/progression/results', import.meta.url)),
  reporter: [['line'], ['html', { outputFolder: fileURLToPath(new URL('../../reports/progression/html', import.meta.url)), open: 'never' }],
    [fileURLToPath(new URL('../../telemetry/TelemetryReporter.js', import.meta.url))]],
  projects: [{ name: 'temporal-progression', use: { browserName: 'chromium' } }],
})
