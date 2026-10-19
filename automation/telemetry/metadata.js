import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
export const AUTOMATION_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PROJECT_ROOT = path.dirname(AUTOMATION_ROOT)
export const EXPERIMENT_FIELDS = Object.freeze(['locator_mutation', 'fault_variant', 'experiment_id', 'scenario_variant'])

function sourceHash(root, entries) {
  const hash = createHash('sha256')
  function visit(relative) {
    const file = path.join(root, relative)
    if (!fs.existsSync(file)) return
    const stat = fs.lstatSync(file)
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name))
    else if (stat.isFile()) hash.update(relative.split(path.sep).join('/') + '\0').update(fs.readFileSync(file)).update('\0')
  }
  for (const entry of [...entries].sort()) visit(entry)
  return hash.digest('hex')
}

export function createRunMetadata(config) {
  const automationPackage = JSON.parse(fs.readFileSync(path.join(AUTOMATION_ROOT, 'package.json'), 'utf8'))
  const appPackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'frontend/package.json'), 'utf8'))
  let commit = 'unknown'
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { /* Source fingerprints still identify uncommitted or non-Git checkouts. */ }
  return {
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    app_version: `${appPackage.version}+sha256:${sourceHash(path.join(PROJECT_ROOT, 'frontend'), ['src', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'public'])}`,
    test_version: `${automationPackage.version}+sha256:${sourceHash(AUTOMATION_ROOT, ['pages', 'tests', 'fixtures', 'utils', 'telemetry', 'playwright.config.js', 'package.json', 'package-lock.json'])}`,
    framework_version: automationPackage.version,
    playwright_version: require('@playwright/test/package.json').version,
    environment: {
      node_version: process.version, platform: process.platform, architecture: process.arch,
      os_release: os.release(), hostname: os.hostname(), ci: Boolean(process.env.CI),
      workers: config.workers, git_commit: commit,
    },
  }
}

export function testIdentity(test) {
  const explicit = test.title.match(/^([A-Z][A-Z0-9_]*-\d+)\b/)
  if (explicit) return explicit[1]
  // Fallback is deterministic, but renaming/moving an unnumbered test changes this ID.
  const key = [path.relative(PROJECT_ROOT, test.location.file).split(path.sep).join('/'), ...describePath(test), test.title].join('::')
  return `AUTO-${createHash('sha256').update(key).digest('hex')}`
}

export function describePath(test) {
  const names = []
  for (let suite = test.parent; suite; suite = suite.parent) if (suite.type === 'describe') names.unshift(suite.title)
  return names
}

export function experimentMetadata(annotations = []) {
  return Object.fromEntries(EXPERIMENT_FIELDS.map(field => [field,
    annotations.findLast(annotation => annotation.type === field)?.description ?? process.env[field.toUpperCase()] ?? '',
  ]))
}
