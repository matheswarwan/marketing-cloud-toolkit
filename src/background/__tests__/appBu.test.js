import { describe, it, expect, vi, beforeEach } from 'vitest'

// Apps that stay in the business unit they signed in to (user, 2026-11-17; checked live on s10).
const created = []
const removed = []
vi.mock('../chromeAsync.js', () => ({
  createTab: async (o) => { created.push(o); return { id: created.length } },
  removeTab: (id) => { removed.push(id) },
  delay: () => Promise.resolve(),
}))
const { ensureAppInCurrentUnit, forgetAppUnits, noteContextSwitch, buTiming } = await import('../appBu.js')
const { findApp } = await import('../apps.js')

const cb = findApp('contentBuilder')
let clock = 0
const now = () => clock

beforeEach(() => {
  created.length = 0
  removed.length = 0
  forgetAppUnits()
  clock = 1_000_000
})

describe('apps that stay in their business unit', () => {
  it('marks Content Builder and Journey Builder, and not the apps that follow SFMC', () => {
    expect(findApp('contentBuilder').followsBusinessUnit).toBe(false)
    expect(findApp('journeyBuilder').followsBusinessUnit).toBe(false)
    expect(findApp('journeyBuilder').tokenContextUrl('s10')).toBe('https://jbinteractions.s10.marketingcloudapps.com/fuelapi/platform/v1/tokenContext')
    for (const id of ['automationStudio', 'contactsMeta', 'cloudPages']) expect(findApp(id).followsBusinessUnit).toBeUndefined()
  })

  it('leaves an app in the current unit alone and remembers it for a while', async () => {
    const appMid = vi.fn(async () => 515010937)
    const deps = { currentMid: async () => 515010937, appMid, now }
    expect(await ensureAppInCurrentUnit(cb, 's10', deps)).toBe('same')
    expect(await ensureAppInCurrentUnit(cb, 's10', deps)).toBe('same')
    expect(appMid).toHaveBeenCalledTimes(1)
    clock += buTiming.checkEveryMs + 1
    await ensureAppInCurrentUnit(cb, 's10', deps)
    expect(appMid).toHaveBeenCalledTimes(2)
    expect(created).toEqual([])
  })

  it('signs an app in another unit in again through its SSO landing, in an inactive tab', async () => {
    const mids = [515010937, 515010937, 515011103] // before, first poll, second poll
    const deps = { currentMid: async () => 515011103, appMid: async () => mids.shift(), now }
    expect(await ensureAppInCurrentUnit(cb, 's10', deps)).toBe('moved')
    expect(created).toEqual([{ url: 'https://mc.s10.exacttarget.com/cloud/tools/SSO.aspx?appId=dcb615e6-146e-4887-9e52-fff1f45c2b1e&hub=1', active: false }])
    expect(removed).toEqual([1])
  })

  it('gives up after the timeout and still closes the tab', async () => {
    const deps = { currentMid: async () => 515011103, appMid: async () => { clock += 5000; return 515010937 }, now }
    expect(await ensureAppInCurrentUnit(cb, 's10', deps)).toBe('failed')
    expect(removed).toEqual([1])
  })

  it('does nothing without a session or a known unit, and never throws', async () => {
    expect(await ensureAppInCurrentUnit(cb, 's10', { currentMid: async () => 515011103, appMid: async () => null, now })).toBe('unknown')
    expect(await ensureAppInCurrentUnit(cb, 's10', { currentMid: async () => null, appMid: async () => 1, now })).toBe('unknown')
    expect(await ensureAppInCurrentUnit(cb, 's10', { currentMid: async () => { throw new Error('x') }, appMid: async () => 1, now })).toBe('unknown')
    expect(await ensureAppInCurrentUnit(findApp('automationStudio'), 's10', { currentMid: async () => 1, appMid: async () => 2, now })).toBe('skip')
    expect(created).toEqual([])
  })

  it('checks again after SFMC switches business unit', async () => {
    const appMid = vi.fn(async () => 515010937)
    const deps = { currentMid: async () => 515010937, appMid, now }
    await ensureAppInCurrentUnit(cb, 's10', deps)
    const seen = []
    noteContextSwitch({ url: 'https://mc.s10.exacttarget.com/cloud/context-switch.html?x=1' }, (s) => { seen.push(s); forgetAppUnits(s) })
    noteContextSwitch({ url: 'https://mc.s10.exacttarget.com/cloud/keep-alive' }, (s) => seen.push(s))
    expect(seen).toEqual(['s10'])
    await ensureAppInCurrentUnit(cb, 's10', deps)
    expect(appMid).toHaveBeenCalledTimes(2)
  })

  it('shares one check between calls made at the same time', async () => {
    const appMid = vi.fn(async () => 515010937)
    const deps = { currentMid: async () => 515010937, appMid, now }
    await Promise.all([ensureAppInCurrentUnit(cb, 's10', deps), ensureAppInCurrentUnit(cb, 's10', deps)])
    expect(appMid).toHaveBeenCalledTimes(1)
  })
})
