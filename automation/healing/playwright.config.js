import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../playwright.config.js'

export default defineConfig({
  ...base,
  projects: ['BASELINE', 'ADAPTIVE'].map(mode => ({ ...base.projects[0], name: mode.toLowerCase(), use: { ...base.projects[0].use, healingMode: mode } })),
  testDir: fileURLToPath(new URL('evaluation', import.meta.url)),
  fullyParallel: false, workers: 1, retries: 0, timeout: 20_000,
  expect: { timeout: 900 },
  outputDir: fileURLToPath(new URL('../reports/healing/results', import.meta.url)),
  use: { ...base.use, trace: 'on', screenshot: 'on' },
  reporter: [
    ['list'],
    ['html', { outputFolder: fileURLToPath(new URL('../reports/healing/html', import.meta.url)), open: 'never' }],
    [fileURLToPath(new URL('../telemetry/TelemetryReporter.js', import.meta.url))],
  ],
})
