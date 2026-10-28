import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetched = []
let status = 6
let journeyStatus = 'Published'
vi.mock('../fetchProxy.js', () => ({
  sfmcFetch: async ({ url }) => {
    fetched.push(url)
    if (url.includes('jbinteractions')) return { id: 'j2', key: 'k1', name: 'Welcome', status: journeyStatus, version: 2, modifiedDate: '2026-10-19T10:00:00' }
    return { name: 'Daily load', status, lastRunTime: '2026-10-19T10:00:00', lastRunStatus: 'Complete' }
  },
}))

function fakeChrome() {
  const data = {}
  const badge = []
  globalThis.chrome = {
    runtime: { lastError: undefined, getURL: (p) => p },
    storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))),
      set: async (obj) => { Object.assign(data, structuredClone(obj)) },
    } },
    action: { setBadgeText: async (o) => badge.push(o.text), setBadgeBackgroundColor: async () => {} },
  }
  return { data, badge }
}

describe('checkWatches (feedback #50)', () => {
  beforeEach(() => { vi.resetModules(); fetched.length = 0; status = 6 })

  it('records a baseline, then turns a pause into a notice and a badge', async () => {
    const { data, badge } = fakeChrome()
    data.toolkit_watches = { 's4:A1': { stack: 's4', id: 'A1', name: 'Daily load', on: { paused: true, activated: true, runs: false, fails: true }, last: null } }
    const { checkWatches } = await import('../watches.js')
    expect(await checkWatches('s4', { force: true })).toEqual({ checked: 1, notices: 0 })
    expect(data.toolkit_watches['s4:A1'].last.statusName).toBe('Scheduled')
    status = 4
    expect(await checkWatches('s4', { force: true })).toEqual({ checked: 1, notices: 1 })
    expect(data.toolkit_watch_notices[0]).toMatchObject({ kind: 'paused', name: 'Daily load', read: false })
    expect(badge.at(-1)).toBe('1')
    expect(fetched[0]).toBe('https://mc.s4.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations/A1')
  })

  it('waits 15 minutes between page-load checks and ignores other stacks', async () => {
    const { data } = fakeChrome()
    data.toolkit_watches = { 's4:A1': { stack: 's4', id: 'A1', name: 'x', on: {}, last: null } }
    const { checkWatches } = await import('../watches.js')
    await checkWatches('s4')
    expect(await checkWatches('s4')).toEqual({ checked: 0, notices: 0 })
    expect(await checkWatches('s7', { force: true })).toEqual({ checked: 0, notices: 0 })
    expect(fetched).toHaveLength(1)
  })

  it('checks a watched journey by its key and links the notice to the latest version (feedback #59)', async () => {
    const { data } = fakeChrome()
    journeyStatus = 'Paused'
    data.toolkit_watches = { 's4:journey:j1': { type: 'journey', stack: 's4', id: 'j1', key: 'k1', name: 'Welcome', on: { paused: true }, last: { status: 'Published', version: 1, modifiedDate: '2026-10-01T00:00:00Z' } } }
    const { checkWatches } = await import('../watches.js')
    expect(await checkWatches('s4', { force: true })).toEqual({ checked: 1, notices: 1 })
    expect(fetched[0]).toBe('https://jbinteractions.s4.marketingcloudapps.com/fuelapi/interaction/v1/interactions/key:k1')
    expect(data.toolkit_watch_notices[0]).toMatchObject({ type: 'journey', journeyId: 'j2', kind: 'paused' })
    expect(data.toolkit_watches['s4:journey:j1']).toMatchObject({ id: 'j1', latestId: 'j2', last: { status: 'Paused', version: 2 } })
  })
})
