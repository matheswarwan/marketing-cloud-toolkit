// Stack resolution, connection status and Query Studio capture (ported from SFMC
// Query Saver's backgroundStack.test.js).
import { describe, it, expect } from 'vitest'
import { loadSW, flush } from './harness.js'

const s10Tab = { url: 'https://mc.s10.exacttarget.com/cloud/' }

describe('stack resolution', () => {
  it('prefers the open s10 tab over a leftover s13 cookie (Query Saver feedback #15)', async () => {
    const sw = await loadSW({ tabs: [s10Tab], loggedIn: ['s13'] })
    const res = await sw.send({ type: 'GET_SESSION' })
    expect(res.session.stackKey).toBe('s10')
    await flush()
    expect(sw.local.sfmcStack).toBe('s10')
  })

  it('takes the most recently used SFMC tab when tabs from two stacks are open', async () => {
    const sw = await loadSW({
      tabs: [
        { url: 'https://mc.s13.exacttarget.com/cloud/', lastAccessed: 100 },
        { url: 'https://mc.s10.exacttarget.com/cloud/', lastAccessed: 200 },
      ],
    })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s10')
  })

  it('uses the remembered active tab stack while a tab of that stack is still open', async () => {
    const sw = await loadSW({
      tabs: [
        { url: 'https://mc.s13.exacttarget.com/cloud/', lastAccessed: 300 },
        { url: 'https://content-builder.s10.marketingcloudapps.com/', lastAccessed: 200 },
      ],
      session: { lastActiveStack: { stack: 's10', ts: 1 } },
    })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s10')
  })

  it('counts Journey Builder and CloudPages tabs too', async () => {
    const sw = await loadSW({ tabs: [{ url: 'https://jbinteractions.s7.marketingcloudapps.com/' }], loggedIn: ['s13'] })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s7')
  })

  it('ignores login pages', async () => {
    const sw = await loadSW({ tabs: [{ url: 'https://mc.login.exacttarget.com/hub-cas/login' }], loggedIn: ['s7'] })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s7')
  })

  it('takes the stack of a stackless mc.exacttarget.com tab from its requests (feedback #76)', async () => {
    const sw = await loadSW({ tabs: [{ url: 'https://mc.exacttarget.com/cloud/#app/Setup/Users' }], loggedIn: ['s7'] })
    for (const fn of sw.onBeforeRequest.fns) fn({ tabId: 1, url: 'https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/' })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s13')
    await flush()
    expect(sw.session.tabStacks).toEqual({ 1: 's13' })
  })

  it('checks each stack for a stackless tab whose stack is not known yet (feedback #76)', async () => {
    const sw = await loadSW({ tabs: [{ url: 'https://mc.exacttarget.com/cloud/' }], liveStacks: ['s13'] })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s13')
  })

  it('ignores requests the extension makes itself (no tab)', async () => {
    const sw = await loadSW({ tabs: [{ url: 'https://mc.exacttarget.com/cloud/' }], liveStacks: ['s10'] })
    for (const fn of sw.onBeforeRequest.fns) fn({ tabId: -1, url: 'https://mc.s13.exacttarget.com/cloud/' })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s10')
  })

  it('checks each cookie stack when there are several and no tabs', async () => {
    const sw = await loadSW({ loggedIn: ['s13', 's10'], liveStacks: ['s10'] })
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s10')
  })

  it('reports no session rather than guessing when no cookie stack checks out', async () => {
    const sw = await loadSW({ loggedIn: ['s13', 's10'], liveStacks: [] })
    expect((await sw.send({ type: 'GET_SESSION' })).session).toBeNull()
  })

  it('a pinned stack wins over tabs and cookies, and clearing it goes back to automatic', async () => {
    const sw = await loadSW({ tabs: [s10Tab] })
    let r = await sw.send({ type: 'SET_STACK_OVERRIDE', stack: 'S13' })
    expect(r).toEqual({ stack: 's13', source: 'manual' })
    expect(sw.local.stackOverride).toBe('s13')
    expect(sw.local.sfmcStack).toBe('s13')
    expect((await sw.send({ type: 'GET_SESSION' })).session.stackKey).toBe('s13')

    r = await sw.send({ type: 'SET_STACK_OVERRIDE', stack: null })
    expect(r.stack).toBe('s10')
    expect(sw.local.stackOverride).toBeUndefined()
    expect(sw.local.sfmcStack).toBe('s10')
  })

  it('rejects a value that is not a stack', async () => {
    const sw = await loadSW()
    const r = await sw.send({ type: 'SET_STACK_OVERRIDE', stack: 'evil.com/x' })
    expect(r.error).toMatch(/s10/)
    expect(sw.local.stackOverride).toBeUndefined()
  })

  it('GET_STACKS lists every stack with where it was seen', async () => {
    const sw = await loadSW({ tabs: [s10Tab], loggedIn: ['s10', 's13'] })
    const r = await sw.send({ type: 'GET_STACKS' })
    expect(r.resolved).toBe('s10')
    expect(r.override).toBeNull()
    const byStack = Object.fromEntries(r.candidates.map((c) => [c.stack, c.sources]))
    expect(byStack.s10).toEqual(['tab', 'cookie'])
    expect(byStack.s13).toEqual(['cookie'])
  })
})

describe('connection status', () => {
  it('does not echo a stale stack sent by the page', async () => {
    const sw = await loadSW({ tabs: [s10Tab] })
    const r = await sw.send({ type: 'GET_CONNECTION_STATUS', stackKey: 's13' })
    expect(r.stack).toBe('s10')
    expect(r.areas.core.open).toBe(true)
  })

  it('pre-warms the MCA token, which is then reported ready', async () => {
    const sw = await loadSW({ tabs: [s10Tab], mintable: ['s10'] })
    expect((await sw.send({ type: 'GET_CONNECTION_STATUS' })).mcaTokenReady).toBe(false)
    await flush()
    expect((await sw.send({ type: 'GET_CONNECTION_STATUS' })).mcaTokenReady).toBe(true)
    const mintTabs = sw.sim.created.filter((t) => t.url.includes('update-token.json'))
    expect(mintTabs).toHaveLength(1)
    expect(mintTabs[0].active).toBe(false)
  })

  it('a failed token mint forgets the stack and is not retried on the next poll', async () => {
    const sw = await loadSW({ loggedIn: ['s13'], local: { sfmcStack: 's13', sfmcStackTs: 1 } })
    await sw.send({ type: 'GET_CONNECTION_STATUS' })
    await flush(450) // the mint times out after 300 ms in tests
    const mints = () => sw.sim.created.filter((t) => t.url.includes('mc.s13.marketingcloudapps.com')).length
    expect(mints()).toBe(1)
    expect(sw.local.sfmcStack).toBeUndefined()

    await sw.send({ type: 'GET_CONNECTION_STATUS' })
    await flush(450)
    expect(mints()).toBe(1)
  })
})

describe('Query Studio capture', () => {
  // Off unless turned on in Settings (security review, 2026-10-28).
  const loadOn = async (opts) => {
    const sw = await loadSW(opts)
    sw.local._saveQueryStudio = true
    return sw
  }

  it('saves a captured query, then tags it with the current business unit', async () => {
    const sw = await loadOn({ tabs: [s10Tab], currentBU: { name: 'Acme Child BU', accountId: 5100123 } })
    await sw.captureQuery('SELECT 1 AS x')
    await flush()
    const rec = sw.local.sql_1700000000000
    expect(rec.queryText).toBe('SELECT 1 AS x')
    expect(rec.businessUnit).toEqual({ name: 'Acme Child BU', accountId: 5100123 })
  })

  it('keeps the captured query when the business unit lookup fails', async () => {
    const sw = await loadOn({ tabs: [s10Tab], currentBU: null })
    await sw.captureQuery('SELECT 2 AS y')
    await flush()
    expect(sw.local.sql_1700000000000.queryText).toBe('SELECT 2 AS y')
    expect(sw.local.sql_1700000000000.businessUnit).toBeUndefined()
  })

  it('saves nothing while the setting is off (the default)', async () => {
    const sw = await loadSW({ tabs: [s10Tab] })
    await sw.captureQuery('SELECT 7', 1700000000005)
    await flush()
    expect(sw.local.sql_1700000000005).toBeUndefined()
  })

  it('saves Query Studio 2 runs (feedback #32), body as in its HAR, on any querystudio2 host (#1014)', async () => {
    const sw = await loadOn({ tabs: [s10Tab] })
    await sw.captureQuery('SELECT 3 AS z', 1700000000001, {
      url: 'https://querystudio2-dev-89f7e4653c61.herokuapp.com/query/create',
      extra: { fieldOverrides: [{ name: 'z', type: 'Text', maxLength: 255 }], tab: 0 },
    })
    await sw.captureQuery('SELECT 8', 1700000000006, { url: 'https://querystudio2-prod-0a1b2c3d4e5f.herokuapp.com/query/create' })
    await flush()
    expect(sw.local.sql_1700000000001.queryText).toBe('SELECT 3 AS z')
    expect(sw.local.sql_1700000000006.queryText).toBe('SELECT 8')
  })

  it('ignores other Heroku apps and other Query Studio requests', async () => {
    const sw = await loadOn({ tabs: [s10Tab] })
    await sw.captureQuery('SELECT 4', 1700000000002, { url: 'https://querystudio2-dev-89f7e4653c61.herokuapp.com/query/validate' })
    await sw.captureQuery('SELECT 9', 1700000000007, { url: 'https://someone-else.herokuapp.com/query/create' })
    await flush()
    expect(sw.local.sql_1700000000002).toBeUndefined()
    expect(sw.local.sql_1700000000007).toBeUndefined()
  })

  it('saves and renames records sent by the app', async () => {
    const sw = await loadSW()
    await sw.send({ type: 'SAVE_RECORDS', records: { sql_1: { id: 'sql_1', name: 'a', queryText: 'SELECT 1' } } })
    await sw.send({ type: 'RENAME_QUERY', id: 'sql_1', name: 'b' })
    expect(sw.local.sql_1).toEqual({ id: 'sql_1', name: 'b', queryText: 'SELECT 1' })
  })
})
