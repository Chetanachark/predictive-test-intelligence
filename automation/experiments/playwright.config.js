import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../playwright.config.js'

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '**/*.spec.js',
  testIgnore: '**/progression/**',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 800 },
  outputDir: fileURLToPath(new URL('../reports/experiments/results', import.meta.url)),
  reporter: [
    ['list'],
    ['html', { outputFolder: fileURLToPath(new URL('../reports/experiments/html', import.meta.url)), open: 'never' }],
    [fileURLToPath(new URL('../telemetry/TelemetryReporter.js', import.meta.url))],
  ],
})
