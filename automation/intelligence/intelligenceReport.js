import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { HistoryStore, atomicWrite } from '../telemetry/history.js'
import { validateHistory } from '../telemetry/schema.js'
import { PROJECT_ROOT } from '../telemetry/metadata.js'
import { calculateMetrics } from './metrics.js'
import { calculateRisk, RISK_MODEL } from './riskCalculator.js'
import { analyzeFailures } from './failureAnalyzer.js'
import { generateRecommendations } from './recommendationEngine.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const unique = values => [...new Set(values)].sort()
const experimental = row => Boolean(row.experiment_id || row.emulated || row.locator_mutation || row.fault_variant || row.fault_type || row.injected_at)

export function loadCampaigns(directory) {
  const root = path.join(directory, 'campaigns')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'campaign.json'), 'utf8'))
    if (manifest.campaign_id !== entry.name || !['VERIFIED', 'INVALID', 'RUNNING'].includes(manifest.status)) throw new Error(`Invalid campaign manifest: ${entry.name}`)
    return manifest
  })
}

function verifiedMembership(records, campaigns) {
  const byId = new Map(records.map(row => [row.attempt_id, row]))
  const membership = new Map()
  for (const campaign of campaigns.filter(item => item.status === 'VERIFIED')) {
    if (!Array.isArray(campaign.attempt_ids) || campaign.attempt_ids.length !== campaign.expected_rows ||
        new Set(campaign.attempt_ids).size !== campaign.attempt_ids.length || !Array.isArray(campaign.experiments)) {
      throw new Error(`Incomplete verified campaign: ${campaign.campaign_id}`)
    }
    for (const id of campaign.attempt_ids) {
      const row = byId.get(id)
      const recipe = campaign.experiments.find(item => item.id === row?.experiment_id && item.variant === row?.fault_variant && item.version === row?.mutation_version)
      if (!row || row.record_type !== 'TEST_ATTEMPT' || !recipe || membership.has(id) ||
          row.app_version !== campaign.app_version || row.test_version !== campaign.test_version ||
          !(campaign.run_ids || [campaign.run_id]).includes(row.run_id) ||
          (row.emulated && !row.injection_verified)) throw new Error(`Unverifiable campaign membership: ${id}`)
      membership.set(id, campaign.campaign_id)
    }
  }
  return membership
}

export function buildIntelligenceReport(records, campaigns = [], { generatedAt = new Date().toISOString(), analysisId = randomUUID() } = {}) {
  validateHistory(records)
  const membership = verifiedMembership(records, campaigns)
  const excluded = { runErrors: 0, unverifiedExperimentAttempts: 0, healingEvaluationAttempts: 0 }
  const groups = new Map()
  for (const row of records) {
    if (row.record_type === 'RUN_ERROR') { excluded.runErrors++; continue }
    if (row.experiment_id.startsWith('S6-')) { excluded.healingEvaluationAttempts++; continue }
    const campaignId = membership.get(row.attempt_id)
    if (!campaignId && experimental(row)) { excluded.unverifiedExperimentAttempts++; continue }
    const identity = {
      testId: row.test_id, suiteName: row.suite_name, browser: row.browser, projectName: row.project_name,
      cohort: campaignId ? 'verified-experiment' : 'ordinary', healingMode: row.healing_mode || 'NONE', learningEnabled: row.learningEnabled || false,
      experimentId: row.experiment_id, faultVariant: row.fault_variant,
      scenarioVariant: row.scenario_variant, mutationVersion: row.mutation_version || '',
    }
    const key = JSON.stringify(identity)
    if (!groups.has(key)) groups.set(key, { identity, rows: [] })
    groups.get(key).rows.push(row)
  }
  const tests = [...groups.values()].map(({ identity, rows }) => {
    const metrics = calculateMetrics(rows)
    const scoredIds = new Set(metrics.scoredAttemptIds)
    const failures = analyzeFailures(rows.filter(row => scoredIds.has(row.attempt_id)))
    return {
      ...identity, groupId: hash(identity), testName: [...rows].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.attempt_id.localeCompare(b.attempt_id)).at(-1).test_name, observedNames: unique(rows.map(row => row.test_name)),
      ...metrics, ...calculateRisk(metrics), failures,
      recommendations: generateRecommendations(metrics, failures, identity),
      firstSeen: rows.map(row => row.start_time).sort()[0], lastSeen: rows.map(row => row.end_time).sort().at(-1),
      appVersions: unique(rows.map(row => row.app_version)), testVersions: unique(rows.map(row => row.test_version)),
      campaignIds: unique(rows.map(row => membership.get(row.attempt_id)).filter(Boolean)),
      runIds: unique(rows.map(row => row.run_id)), attemptIds: rows.map(row => row.attempt_id).sort(),
      environmentFingerprints: unique(rows.map(row => hash(row.environment))),
      artifacts: rows.filter(row => row.trace_path || row.screenshot_path).map(row => ({ attemptId: row.attempt_id, tracePath: row.trace_path, screenshotPath: row.screenshot_path })),
    }
  }).sort((a, b) => a.cohort.localeCompare(b.cohort) || (b.riskScore ?? -1) - (a.riskScore ?? -1) || a.testId.localeCompare(b.testId) || a.groupId.localeCompare(b.groupId))
  return {
    reportVersion: 1, analysisId, generatedAt, model: RISK_MODEL,
    source: { recordCount: records.length, recordsSha256: hash(records), campaignManifestsSha256: hash(campaigns) },
    selection: { excluded, acceptedAttempts: tests.reduce((sum, test) => sum + test.attemptCount, 0),
      ordinaryGroups: tests.filter(test => test.cohort === 'ordinary').length,
      experimentGroups: tests.filter(test => test.cohort === 'verified-experiment').length },
    limitations: [
      'Sprint 6 controlled healing evaluations are excluded here; use their dedicated verified evaluation manifests.',
      'Retrospective heuristic priority score; not a predicted failure probability or a validated ML model.',
      'Locator volatility is the fraction of executions affected by observed locator failures, not measured DOM or locator revision frequency.',
      'Ordinary means no experiment metadata; legacy records cannot prove the absence of injected faults.',
      'Scores aggregate available versions and environments within each identity; inspect provenance before comparing results.',
      'No recency weighting or statistical confidence claim; LIMITED_HISTORY means fewer than 10 scored executions.',
      'Skipped, interrupted, incomplete retry chains and expected non-pass tests are excluded from scored execution metrics.',
    ],
    runErrors: records.filter(row => row.record_type === 'RUN_ERROR').map(row => ({ attemptId: row.attempt_id, runId: row.run_id, failureType: row.failure_type, message: row.error_message })),
    tests,
  }
}

export function reportCSV(report) {
  const columns = ['groupId', 'testId', 'testName', 'suiteName', 'browser', 'projectName', 'cohort', 'healingMode', 'learningEnabled', 'experimentId', 'faultVariant',
    'scenarioVariant', 'mutationVersion', 'scoredExecutionCount', 'failureRate', 'stabilityScore', 'retryCost', 'retryRate', 'locatorVolatility', 'riskScore', 'riskLevel', 'evidence', 'recommendations']
  const cell = value => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [columns.join(','), ...report.tests.map(test => columns.map(key => cell(test[key])).join(','))].join('\r\n') + '\r\n'
}

export function generateIntelligenceReport({ directory = process.env.TELEMETRY_DIR || path.join(PROJECT_ROOT, 'dataset') } = {}) {
  const store = new HistoryStore(directory)
  const records = store.validate()
  const report = buildIntelligenceReport(records, loadCampaigns(directory))
  report.source.intelligenceCodeSha256 = hash(['metrics.js', 'riskCalculator.js', 'failureAnalyzer.js', 'recommendationEngine.js', 'intelligenceReport.js']
    .map(file => [file, fs.readFileSync(new URL(file, import.meta.url), 'utf8')]))
  const root = path.join(directory, 'intelligence')
  const output = path.join(root, report.analysisId)
  fs.mkdirSync(output, { recursive: true })
  const json = JSON.stringify(report, null, 2) + '\n'
  const csv = reportCSV(report)
  atomicWrite(path.join(output, 'intelligence-report.json'), json)
  atomicWrite(path.join(output, 'test-intelligence.csv'), csv)
  // Publish one pointer only after both immutable snapshot files are complete.
  atomicWrite(path.join(root, 'latest.json'), JSON.stringify({ analysisId: report.analysisId,
    json: `${report.analysisId}/intelligence-report.json`, csv: `${report.analysisId}/test-intelligence.csv`,
    jsonSha256: createHash('sha256').update(json).digest('hex'), csvSha256: createHash('sha256').update(csv).digest('hex'),
  }, null, 2) + '\n')
  return { report, output }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { report, output } = generateIntelligenceReport()
    console.log(JSON.stringify({ output, source: report.source, selection: report.selection }, null, 2))
  } catch (error) {
    console.error(`Intelligence report failed: ${error.message}`)
    process.exitCode = 1
  }
}
