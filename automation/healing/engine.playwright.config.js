import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../playwright.config.js'
export default defineConfig({
  ...base, webServer: undefined,
  testDir: fileURLToPath(new URL('tests', import.meta.url)),
  workers: 1, retries: 0, timeout: 10_000,
  outputDir: fileURLToPath(new URL('../reports/healing-engine/results', import.meta.url)),
  reporter: [ ['list'], [fileURLToPath(new URL('../telemetry/TelemetryReporter.js', import.meta.url)), { directory: fileURLToPath(new URL('../reports/healing-engine/telemetry', import.meta.url)) }], ['html', { outputFolder: fileURLToPath(new URL('../reports/healing-engine/html', import.meta.url)), open: 'never' }] ],
})
