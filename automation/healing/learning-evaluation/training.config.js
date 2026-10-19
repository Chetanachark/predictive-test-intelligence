import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../../playwright.config.js'
export default defineConfig({
  ...base, testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: 'training.spec.js',
  workers: 1, retries: 0, fullyParallel: false, timeout: 20_000, expect: { timeout: 900 },
  projects: [{ ...base.projects[0], name: 'training', use: { ...base.projects[0].use, learningEnabled: true } }],
  use: { ...base.use, trace: 'on', screenshot: 'on' },
  outputDir: fileURLToPath(new URL('../../reports/learning-training/results', import.meta.url)),
  reporter: [ ['list'], ['html', { outputFolder: fileURLToPath(new URL('../../reports/learning-training/html', import.meta.url)), open: 'never' }],
    [fileURLToPath(new URL('../../telemetry/TelemetryReporter.js', import.meta.url))] ],
})
