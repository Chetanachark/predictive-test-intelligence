import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from './training.config.js'
export default defineConfig({
  ...base, testMatch: 'comparison.spec.js',
  projects: ['baseline-healing', 'adaptive-healing'].map(name => ({ ...base.projects[0], name,
    use: { ...base.projects[0].use, learningEnabled: name === 'adaptive-healing' } })),
  outputDir: fileURLToPath(new URL('../../reports/learning-comparison/results', import.meta.url)),
  reporter: [ ['list'], ['html', { outputFolder: fileURLToPath(new URL('../../reports/learning-comparison/html', import.meta.url)), open: 'never' }],
    [fileURLToPath(new URL('../../telemetry/TelemetryReporter.js', import.meta.url))] ],
})
