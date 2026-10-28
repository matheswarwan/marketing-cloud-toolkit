import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake service worker: handler(url) returns data, or an Error for a failed call.
function stub(handler) {
  const calls = []
  vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
    calls.push(msg.url)
    Promise.resolve(handler(msg.url, msg)).then((data) => cb(data instanceof Error ? { error: data.message, status: 400 } : { data }))
  } } })
  return calls
}

const auto = (n) => ({ id: `a${n}`, name: `Automation ${n}` })
const range = (from, to) => Array.from({ length: to - from }, (_, i) => auto(from + i))

describe('loadMoreAutomations (feedback #28)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('uses the $skip page when it brings new automations', async () => {
    stub((url) => (url.includes('$skip=50') ? { entry: range(50, 80), totalResults: 80 } : {}))
    const { loadMoreAutomations } = await import('../automationApi.js')
    const r = await loadMoreAutomations('s4', '', range(0, 50))
    expect(r.entries.map((a) => a.id)).toEqual(range(50, 80).map((a) => a.id))
    expect(r.total).toBe(80)
  })

  it('asks for a larger first page when $skip repeats the first page', async () => {
    const calls = stub((url) => {
      if (url.includes('$skip=50')) return { entry: range(0, 50), totalResults: 80 }
      if (url.includes('$top=100')) return { entry: range(0, 80), totalResults: 80 }
      return {}
    })
    const { loadMoreAutomations } = await import('../automationApi.js')
    const r = await loadMoreAutomations('s4', '', range(0, 50))
    expect(r.entries.map((a) => a.id)).toEqual(range(50, 80).map((a) => a.id))
    expect(calls.some((u) => u.includes('$top=100') && u.includes('$skip=0'))).toBe(true)
  })
})

describe('searchActivities without sorting (feedback #29)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('retries without $orderBy, sorts the page itself and remembers it', async () => {
    const calls = stub((url) => {
      if (url.includes('$orderBy')) return new Error("SFMC API error 400: Order field is invalid, the following field is not allowed: 'modifiedDate'")
      return { count: 2, items: [{ id: 'f1', modifiedDate: '2026-01-01' }, { id: 'f2', modifiedDate: '2026-05-01' }] }
    })
    const { searchActivities } = await import('../automationApi.js')
    const r = await searchActivities('s4', 'imports', '')
    expect(r.unsorted).toBe(true)
    expect(r.items.map((i) => i.id)).toEqual(['f2', 'f1'])
    await searchActivities('s4', 'imports', '', 2)
    expect(calls.filter((u) => u.includes('$orderBy'))).toHaveLength(1)
  })

  it('never asks filters to sort (#67 report)', async () => {
    const calls = stub(() => ({ count: 2, items: [{ id: 'f1', modifiedDate: '2026-01-01' }, { id: 'f2', modifiedDate: '2026-05-01' }] }))
    const { searchActivities } = await import('../automationApi.js')
    const r = await searchActivities('s4', 'filters', '')
    expect(r.unsorted).toBe(true)
    expect(r.items.map((i) => i.id)).toEqual(['f2', 'f1'])
    expect(calls.some((u) => u.includes('$orderBy'))).toBe(false)
  })

  it('still throws other errors', async () => {
    stub(() => new Error('SFMC API error 500: boom'))
    const { searchActivities } = await import('../automationApi.js')
    await expect(searchActivities('s4', 'queries', '')).rejects.toThrow('boom')
  })
})

describe('Run Query target DE retention (feedback #27)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('parses the setting: no retention unless set', async () => {
    const { parseRetentionDays, DEFAULT_RETENTION_DAYS } = await import('../sfmcApi.js')
    expect(DEFAULT_RETENTION_DAYS).toBe(0)
    expect(parseRetentionDays(undefined)).toBe(0)
    expect(parseRetentionDays(0)).toBe(0)
    expect(parseRetentionDays(30)).toBe(30)
    expect(parseRetentionDays(-1)).toBe(0)
    expect(parseRetentionDays(1.5)).toBe(0)
  })

  it('sends row-based retention and falls back without it when SFMC refuses', async () => {
    const bodies = []
    stub((url, msg) => {
      bodies.push(msg.body)
      return msg.body.dataRetentionProperties ? new Error('SFMC API error 400: invalid dataRetentionProperties') : { id: 'de1' }
    })
    const { createTargetDE } = await import('../sfmcApi.js')
    const r = await createTargetDE('s4', { name: 'X', fields: [], categoryID: 1, retentionDays: 7 })
    expect(r).toEqual({ id: 'de1' })
    expect(bodies[0].dataRetentionProperties).toMatchObject({ isRowBasedRetention: true, dataRetentionPeriodLength: 7, dataRetentionPeriodUnitOfMeasure: 3 })
    expect(bodies[1].dataRetentionProperties).toBeUndefined()
  })

  it('sends no retention for 0 days', async () => {
    const bodies = []
    stub((url, msg) => { bodies.push(msg.body); return { id: 'de1' } })
    const { createTargetDE } = await import('../sfmcApi.js')
    await createTargetDE('s4', { name: 'X', fields: [], categoryID: 1, retentionDays: 0 })
    expect(bodies).toHaveLength(1)
    expect(bodies[0].dataRetentionProperties).toBeUndefined()
  })
})

describe('apiCallPath', () => {
  it('keeps paging and sort values and hides the rest', async () => {
    const { apiCallPath } = await import('../sfmcApi.js')
    expect(apiCallPath('https://mc.s4.marketingcloudapps.com/x/automations/?$top=50&$skip=50&$where=name%20like%20Secret'))
      .toBe('mc.s4.marketingcloudapps.com/x/automations/?$top=50&$skip=50&$where=…')
  })
})

describe('run history (feedback #41)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('asks for runs the way Automation Studio does and reads them', async () => {
    const calls = stub(() => ({ totalResults: 2, entry: [
      { id: 'r1', startTime: '2026-10-20T10:00:00', endTime: '2026-10-20T10:02:30', status: 'Complete' },
      { InstanceId: 'r2', StartTime: '2026-10-19T10:00:00', StatusName: 'Error', StatusMessage: 'Query failed' },
    ] }))
    const { fetchRunHistory } = await import('../automationApi.js')
    const r = await fetchRunHistory('s12', 'MHla:25:0', { days: 30, now: new Date('2026-10-20T16:00:00Z') })
    expect(calls[0]).toBe('https://mc.s12.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/legacy/v1/beta/automations/automation/instance/?definition_id=MHla%3A25%3A0&$top=50&begin_date=2026-09-20&end_date=2026-10-20&order_by=StartTime%20desc&to_server_time=1')
    expect(r.total).toBe(2)
    expect(r.runs[0]).toMatchObject({ id: 'r1', status: 'Complete', durationMs: 150000 })
    expect(r.runs[1]).toMatchObject({ id: 'r2', status: 'Error', message: 'Query failed', durationMs: null })
    expect(r.runs[1].raw.InstanceId).toBe('r2')
  })
})
