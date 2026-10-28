// SFMC_FETCH: Query Saver's Bearer and CSRF handling plus Automation Viewer's per-app
// session warm-up (ported from its sfmcAuth.test.js).
import { describe, it, expect } from 'vitest'
import { loadSW, flush } from './harness.js'

const JB = 'https://jbinteractions.s10.marketingcloudapps.com/fuelapi/interaction/v1/eventDefinitions?$page=1&$pagesize=1000'
const JB_LANDING = 'https://mc.s10.exacttarget.com/cloud/#app/Journey%20Builder'
const AS = 'https://mc.s10.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations/abc'
const CB = 'https://content-builder.s10.marketingcloudapps.com/fuelapi/asset/v1/content/assets/query'
const CP_FIRST = 'https://cloud-pages.s10.marketingcloudapps.com/update-token.json'
const CP_SECOND = 'https://mc.s10.exacttarget.com/cloud/#app/CloudPages'
const CP = 'https://cloud-pages.s10.marketingcloudapps.com/fuelapi/internal/v2/cloudpages/sites?$page=1&$pagesize=5000'
const CORE = 'https://mc.s10.exacttarget.com/cloud/fuelapi/internal/v1/customobjects/'

const callsTo = (sw, prefix) => sw.sim.fetched.filter((f) => f.url.startsWith(prefix))

describe('core (exacttarget.com)', () => {
  it('GET uses cookies only and returns parsed JSON', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    const r = await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'GET' })
    expect(r.data).toEqual({ ok: true, url: CORE })
    const [call] = callsTo(sw, CORE)
    expect(call.headers.Authorization).toBeUndefined()
    expect(call.headers['X-CSRF-Token']).toBeUndefined()
  })

  it('a POST sends the CSRF token captured from an earlier response', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'GET' })
    await flush()
    await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'POST', body: { a: 1 } })
    const post = callsTo(sw, CORE).find((c) => c.method === 'POST')
    expect(post.headers['X-CSRF-Token']).toBe('core-s10')
    expect(post.body).toBe('{"a":1}')
  })

  it('picks up a CSRF token from SFMC\'s own requests', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    sw.onBeforeSendHeaders.fns[0]({ url: CORE, requestHeaders: [{ name: 'X-CSRF-Token', value: 'sniffed' }] })
    await flush()
    await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'DELETE' })
    expect(callsTo(sw, CORE)[0].headers['X-CSRF-Token']).toBe('sniffed')
  })

  it('a login redirect fails with LOGIN_REQUIRED and forgets the stack', async () => {
    const sw = await loadSW({ liveStacks: [], local: { sfmcStack: 's10' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'GET' })
    expect(r.code).toBe('SFMC_LOGIN_REQUIRED')
    expect(r.error).toMatch(/session expired/)
    expect(sw.local.sfmcStack).toBeUndefined()
  })

  it('an API error keeps Query Saver\'s message format and status', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    sw.sim.apiStatus = 500
    const r = await sw.send({ type: 'SFMC_FETCH', url: CORE, method: 'GET' })
    expect(r.error).toBe('SFMC API error 500: boom')
    expect(r.status).toBe(500)
  })
})

describe('Bearer apps (Automation Studio, Contact Builder meta, Content Builder)', () => {
  it('mints the MCA token in an inactive tab and sends it', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], mintable: ['s10'] })
    const r = await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    expect(r.data.ok).toBe(true)
    expect(callsTo(sw, AS)[0].headers.Authorization).toBe('Bearer jwt-s10-1')
    expect(sw.sim.removed).toHaveLength(1)
  })

  it('re-mints once when the cached token is rejected', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], mintable: ['s10'] })
    await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    sw.sim.tokens.clear()
    const r = await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    expect(r.data.ok).toBe(true)
    expect(callsTo(sw, AS).map((c) => c.headers.Authorization)).toEqual(['Bearer jwt-s10-1', 'Bearer jwt-s10-1', 'Bearer jwt-s10-2'])
  })

  it('falls back to a session warm-up when no token can be minted', async () => {
    const landing = 'https://mc.s10.marketingcloudapps.com/AutomationStudioFuel3/update-token.json'
    const sw = await loadSW({ loggedIn: ['s10'], landings: { [landing]: 'automationStudio' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    expect(r.data.ok).toBe(true)
  })

  it('treats a login page in place of data as no session and warms the app up (feedback #93)', async () => {
    const landing = 'https://mc.s10.marketingcloudapps.com/AutomationStudioFuel3/update-token.json'
    const sw = await loadSW({ loggedIn: ['s10'], landings: { [landing]: 'automationStudio' }, loginPageWhenNoSession: true })
    const r = await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    expect(r.data.ok).toBe(true)
    expect(sw.sim.created.map((t) => t.url)).toContain(landing)
  })

  it('fails with SESSION_UNAVAILABLE and the app to log in to when the login page stays (feedback #93)', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], loginPageWhenNoSession: true })
    const r = await sw.send({ type: 'SFMC_FETCH', url: AS, method: 'GET' })
    expect(r.code).toBe('SFMC_SESSION_UNAVAILABLE')
    expect(r.app).toEqual({ id: 'automationStudio', name: 'Automation Studio', url: 'https://mc.s10.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/' })
    expect(r.data).toBeUndefined()
  })

  it('a Content Builder write echoes the CSRF cookie; a GET sends none', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], mintable: ['s10'] })
    await sw.send({ type: 'SFMC_FETCH', url: CB, method: 'GET' })
    const r = await sw.send({ type: 'SFMC_FETCH', url: CB, method: 'POST', body: {} })
    expect(r.data.ok).toBe(true)
    const [get, post] = callsTo(sw, CB)
    expect(get.headers['X-CSRF-Token']).toBeUndefined()
    expect(post.headers['X-CSRF-Token']).toBe('csrf-1')
  })

  it('re-reads a CSRF cookie that rotated between read and request', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], mintable: ['s10'] })
    sw.sim.rotateCsrfBeforeNextWrite = true
    const r = await sw.send({ type: 'SFMC_FETCH', url: CB, method: 'PUT', body: {} })
    expect(r.data.ok).toBe(true)
    expect(callsTo(sw, CB).map((c) => c.headers['X-CSRF-Token'])).toEqual(['csrf-0', 'csrf-1'])
  })
})

describe('cookie-session apps (Journey Builder, CloudPages)', () => {
  it('warms up a missing session in one inactive tab, closes it, and retries without a Bearer token', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], mintable: ['s10'], landings: { [JB_LANDING]: 'journeyBuilder' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: JB, method: 'GET' })
    expect(r.data.ok).toBe(true)
    expect(sw.sim.created).toEqual([{ url: JB_LANDING, active: false }])
    expect(sw.sim.removed).toHaveLength(1)
    expect(callsTo(sw, 'https://jbinteractions.').every((c) => !c.headers.Authorization)).toBe(true)
  })

  it('needs no tab when the app already has a session', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], sessions: ['s10:journeyBuilder'] })
    expect((await sw.send({ type: 'SFMC_FETCH', url: JB })).data.ok).toBe(true)
    expect(sw.sim.created).toHaveLength(0)
  })

  it('concurrent requests share one warm-up', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], landings: { [JB_LANDING]: 'journeyBuilder' } })
    const [a, b] = await Promise.all([sw.send({ type: 'SFMC_FETCH', url: JB }), sw.send({ type: 'SFMC_FETCH', url: JB })])
    expect(a.data.ok && b.data.ok).toBe(true)
    expect(sw.sim.created).toHaveLength(1)
  })

  it('tries the next landing page when the first does not start a session', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], landings: { [CP_SECOND]: 'cloudPages' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: CP })
    expect(r.data.ok).toBe(true)
    expect(sw.sim.created.map((t) => t.url)).toEqual([CP_FIRST, CP_SECOND])
  })

  it('not logged in: LOGIN_REQUIRED, no tab, stack forgotten', async () => {
    const sw = await loadSW({ loggedIn: [], local: { sfmcStack: 's10' }, landings: { [JB_LANDING]: 'journeyBuilder' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: JB })
    expect(r.code).toBe('SFMC_LOGIN_REQUIRED')
    expect(sw.sim.created).toHaveLength(0)
    expect(sw.local.sfmcStack).toBeUndefined()
  })

  it('bootstrap: false never opens a tab', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], landings: { [JB_LANDING]: 'journeyBuilder' } })
    const r = await sw.send({ type: 'SFMC_FETCH', url: JB, bootstrap: false })
    expect(r.code).toBe('SFMC_LOGIN_REQUIRED')
    expect(sw.sim.created).toHaveLength(0)
  })

  it('after a failed warm-up, fails fast instead of opening another tab', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    const first = await sw.send({ type: 'SFMC_FETCH', url: JB })
    expect(first.code).toBe('SFMC_SESSION_UNAVAILABLE')
    const tabs = sw.sim.created.length
    const second = await sw.send({ type: 'SFMC_FETCH', url: JB })
    expect(second.code).toBe('SFMC_SESSION_UNAVAILABLE')
    expect(sw.sim.created.length).toBe(tabs)
  })
})

describe('app sessions in the connection menu', () => {
  it('SFMC_SESSION_STATUS reports each app and never opens a tab', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], sessions: ['s10:cloudPages'] })
    const { status } = await sw.send({ type: 'SFMC_SESSION_STATUS', stack: 's10' })
    expect(status.loggedIn).toBe(true)
    expect(Object.fromEntries(status.apps.map((a) => [a.id, a.ok]))).toEqual({
      automationStudio: false, contactsMeta: false, contentBuilder: false, cloudPages: true, journeyBuilder: false,
    })
    expect(sw.sim.created).toHaveLength(0)
  })

  it('SFMC_CONNECT_APP starts a session even during a cooldown', async () => {
    const sw = await loadSW({ loggedIn: ['s10'] })
    await sw.send({ type: 'SFMC_FETCH', url: JB })
    sw.sim.landings[JB_LANDING] = 'journeyBuilder'
    const r = await sw.send({ type: 'SFMC_CONNECT_APP', stack: 's10', appId: 'journeyBuilder' })
    expect(r).toEqual({ ok: true })
    expect((await sw.send({ type: 'SFMC_FETCH', url: JB })).data.ok).toBe(true)
  })
})

describe('starting the missing app sessions (SFMC_WARM_UP)', () => {
  const JB_LAND = 'https://mc.s10.exacttarget.com/cloud/#app/Journey%20Builder'
  const CB_LAND = 'https://mc.s10.exacttarget.com/cloud/#app/Content%20Builder'
  const CP_LAND = 'https://cloud-pages.s10.marketingcloudapps.com/update-token.json'
  const CM_LAND = 'https://mc.s10.marketingcloudapps.com/contactsmeta/'
  const landings = { [JB_LAND]: 'journeyBuilder', [CB_LAND]: 'contentBuilder', [CP_LAND]: 'cloudPages', [CM_LAND]: 'contactsMeta' }

  it('starts every missing app when one already has a session, one tab at a time', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], sessions: ['s10:automationStudio'], landings })
    const r = await sw.send({ type: 'SFMC_WARM_UP', stack: 's10' })
    expect(r.result.started.sort()).toEqual(['cloudPages', 'contactsMeta', 'contentBuilder', 'journeyBuilder'])
    expect(sw.sim.created.map((t) => t.url).sort()).toEqual([CB_LAND, CM_LAND, CP_LAND, JB_LAND].sort())
    expect(sw.sim.created.every((t) => t.active === false)).toBe(true)
    expect(sw.sim.removed).toHaveLength(4)
    const status = await sw.send({ type: 'SFMC_SESSION_STATUS', stack: 's10' })
    expect(status.status.apps.every((a) => a.ok && !a.starting)).toBe(true)
  })

  it('opens nothing when no app has a session, or when not logged in', async () => {
    const none = await loadSW({ loggedIn: ['s10'], landings })
    expect((await none.send({ type: 'SFMC_WARM_UP', stack: 's10' })).result).toEqual({ skipped: 'no app session' })
    expect(none.sim.created).toHaveLength(0)
    const out = await loadSW({ loggedIn: [], sessions: ['s10:automationStudio'], landings })
    expect((await out.send({ type: 'SFMC_WARM_UP', stack: 's10' })).result).toEqual({ skipped: 'not logged in' })
    expect(out.sim.created).toHaveLength(0)
  })

  it('runs at most every 10 minutes unless forced, and can be turned off', async () => {
    const sw = await loadSW({ loggedIn: ['s10'], sessions: ['s10:automationStudio'], landings: {} })
    const first = await sw.send({ type: 'SFMC_WARM_UP', stack: 's10' })
    expect(first.result.failed).toHaveLength(4)
    expect((await sw.send({ type: 'SFMC_WARM_UP', stack: 's10' })).result).toEqual({ skipped: 'recently' })
    sw.sim.landings[JB_LAND] = 'journeyBuilder'
    const forced = await sw.send({ type: 'SFMC_WARM_UP', stack: 's10', force: true })
    expect(forced.result.started).toContain('journeyBuilder')
    const off = await loadSW({ loggedIn: ['s10'], sessions: ['s10:automationStudio'], landings, local: { _autoStartSessions: false } })
    expect((await off.send({ type: 'SFMC_WARM_UP', stack: 's10' })).result).toEqual({ skipped: 'turned off' })
    expect(off.sim.created).toHaveLength(0)
  })
})
