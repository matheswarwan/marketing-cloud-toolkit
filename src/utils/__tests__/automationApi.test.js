import { describe, it, expect } from 'vitest'
import { runErrors, normalizeRun } from '../automationApi.js'
describe('run errors (feedback #157)', () => {
  const raw = { status: 'Error', processes: [{ sequence: 3, workers: ['https://x.rest.marketingcloudapis.com/legacy/v1/beta/automations/worker/instance/ABC'], workerCounts: [{ name: 'ImportDefinition', status: 'Error', error: { translatedMsg: 'Error has occurred' } }] }, { sequence: 1, workerCounts: [{ name: 'QueryDefinition', status: 'Complete' }] }] }
  it('names the failed step and its message', () => {
    expect(runErrors(raw)).toEqual([{ step: 3, activity: 'Import', message: 'Error has occurred', workerUrl: 'https://x.rest.marketingcloudapis.com/legacy/v1/beta/automations/worker/instance/ABC' }])
    expect(normalizeRun(raw).message).toBe('Step 3, Import: Error has occurred')
  })
})
