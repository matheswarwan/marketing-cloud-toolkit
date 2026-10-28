import { describe, it, expect, vi, beforeEach } from 'vitest'
import { summarizeAutomations, summarizeJourneys } from '../overview.js'

describe('overviews (feedback #50)', () => {
  it('counts automations by status and lists what needs a look', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    const s = summarizeAutomations([
      { id: 'a', name: 'A', status: 6, lastRunStatus: 'Complete', lastRunTime: '2026-10-20T10:00:00Z' },
      { id: 'b', name: 'B', status: 'Scheduled', lastRunStatus: 'Error', lastRunTime: '2026-10-20T09:00:00Z' },
      { id: 'c', name: 'C', status: 4 },
      { id: 'd', name: 'D', status: 3, lastRunTime: '2026-10-19T12:00:00Z' },
    ], now)
    expect(s.total).toBe(4)
    expect(s.byStatus).toEqual([{ label: 'Scheduled', count: 2 }, { label: 'Paused', count: 1 }, { label: 'Running', count: 1 }])
    expect(s.failedLastRun).toBe(1)
    expect(s.attention.map((x) => [x.automation.id, x.reason])).toEqual([['b', 'Last run: Error'], ['d', 'Running for more than 6 hours']])
  })
  it('counts journeys and live ones', () => {
    const s = summarizeJourneys([{ status: 'Published' }, { status: 'Draft' }, { status: 'Published' }, { status: 'Stopped' }])
    expect(s).toMatchObject({ total: 4, live: 2 })
    expect(s.byStatus[0]).toEqual({ label: 'Published', count: 2 })
  })
})

describe('run trends and journey channels', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('adds up runs per day and failures per automation', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      if (msg.url.includes('definition_id=A')) return cb({ data: { entry: [
        { startTime: '2026-10-20T08:00:00Z', status: 'Complete' }, { startTime: '2026-10-19T08:00:00Z', status: 'Error' }] } })
      if (msg.url.includes('definition_id=B')) return cb({ error: 'SFMC API error 500' })
      cb({ data: {} })
    } } })
    const { runTrends } = await import('../overview.js')
    const now = Date.parse('2026-10-20T12:00:00Z')
    const r = await runTrends('s4', [
      { id: 'A', name: 'A', lastRunTime: '2026-10-20T08:00:00Z' }, { id: 'B', name: 'B', lastRunTime: '2026-10-19T08:00:00Z' }, { id: 'C', name: 'Old', lastRunTime: '2025-01-01' },
    ], { days: 7, now })
    expect(r.read).toBe(2)
    expect(r.errors).toBe(1)
    expect(r.days.find((d) => d.key === '2026-10-19')).toMatchObject({ key: '2026-10-19', ok: 0, failed: 1 })
    expect(r.days.find((d) => d.key === '2026-10-20')).toMatchObject({ key: '2026-10-20', ok: 1, failed: 0 })
    // Each day lists its runs, for the day view (feedback #62).
    expect(r.days.find((d) => d.key === '2026-10-19').runs).toEqual([expect.objectContaining({ automation: expect.objectContaining({ id: 'A' }), status: 'Error', failed: true })])
    expect(r.perAutomation[0]).toMatchObject({ runs: 2, failed: 1 })
  })

  it('finds which live journeys send email, SMS or push', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      if (msg.url.includes('/interactions/j1')) return cb({ data: { activities: [{ type: 'EMAILV2', name: 'Welcome' }, { type: 'WAIT' }, { type: 'SMSSYNC', name: 'Text' }] } })
      if (msg.url.includes('/interactions/j2')) return cb({ data: { activities: [{ type: 'PUSHNOTIFICATIONACTIVITY', name: 'Push' }] } })
      cb({ data: {} })
    } } })
    const { journeyChannels } = await import('../overview.js')
    const r = await journeyChannels('s4', [{ id: 'j1', name: 'One', status: 'Published' }, { id: 'j2', name: 'Two', status: 'Published' }, { id: 'j3', name: 'Draft', status: 'Draft' }])
    expect(r.checked).toBe(2)
    expect(r.sendingEmail).toBe(1)
    expect(r.rows[0]).toMatchObject({ email: ['Welcome'], sms: ['Text'] })
    expect(r.rows[1].push).toEqual(['Push'])
  })
})

describe('fetchRunsSince (feedback #1007)', () => {
  // A fake run log: one run every 15 minutes for 30 days, newest first, `top` at most,
  // filtered by whole-day end dates like the legacy instance API.
  const now = Date.parse('2026-10-26T12:00:00Z')
  const all = []
  for (let t = now; t > now - 30 * 86400000; t -= 15 * 60000) all.push({ id: String(t), start: new Date(t).toISOString(), status: 'Complete' })
  const fake = async (stack, id, { top, end }) => {
    const endDay = end.toISOString().slice(0, 10)
    return { runs: all.filter((r) => r.start.slice(0, 10) <= endDay).slice(0, top) }
  }
  it('reads past the newest 200 runs', async () => {
    const { fetchRunsSince } = await import('../overview.js')
    const since = now - 10 * 86400000
    const { runs, partialDays } = await fetchRunsSince('s4', 'a', { since, now, days: 10, top: 200, maxCalls: 30, fetch: fake })
    const days = new Set(runs.map((r) => r.start.slice(0, 10)))
    expect(runs.length).toBeGreaterThan(200)
    expect(days.size).toBeGreaterThanOrEqual(10)
    expect(new Set(runs.map((r) => r.id)).size).toBe(runs.length)
    expect(partialDays.size).toBe(0) // 96 runs a day fits in 200
  })
  it('marks a day with more runs than one call returns', async () => {
    const { fetchRunsSince } = await import('../overview.js')
    const { partialDays } = await fetchRunsSince('s4', 'a', { since: now - 3 * 86400000, now, days: 3, top: 50, maxCalls: 10, fetch: fake })
    expect(partialDays.size).toBeGreaterThan(0)
  })
})
