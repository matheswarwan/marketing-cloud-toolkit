// Loads the service worker modules against a fake `chrome` and a simulated SFMC that
// behaves the way the live checks in SFMC Query Saver and SFMC Automation Viewer
// showed:
//   - core (exacttarget.com) answers with the login cookie alone
//   - each marketingcloudapps.com app answers 401 until it has a session, which an
//     inactive tab on a working landing page creates
//   - apps marked `bearer` also accept a minted MCA token; minting opens
//     update-token.json in a tab and content.js reports MCA_TOKEN_CAPTURED
//   - Content Builder writes need X-CSRF-Token equal to its `_csrf` cookie, which
//     rotates on every Content Builder response
import { vi } from 'vitest'

function makeArea(initial = {}) {
  const data = { ...initial }
  const pick = (keys) => (keys == null
    ? { ...data }
    : Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])))
  return {
    data,
    api: {
      get: (keys, cb) => setTimeout(() => cb(pick(keys)), 0),
      set: (obj, cb) => { Object.assign(data, obj); setTimeout(() => cb?.(), 0) },
      remove: (keys, cb) => { [].concat(keys).forEach((k) => delete data[k]); setTimeout(() => cb?.(), 0) },
    },
  }
}

const event = () => {
  const fns = []
  const filters = new Map() // webRequest listeners: fn -> { urls }
  return {
    fns, filters,
    addListener: (fn, filter) => { fns.push(fn); if (filter) filters.set(fn, filter) },
    removeListener: (fn) => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1) },
  }
}

function appIdFor(u) {
  if (u.hostname.startsWith('content-builder.')) return 'contentBuilder'
  if (u.hostname.startsWith('cloud-pages.')) return 'cloudPages'
  if (u.hostname.startsWith('jbinteractions.')) return 'journeyBuilder'
  if (u.pathname.startsWith('/contactsmeta/')) return 'contactsMeta'
  if (u.pathname.startsWith('/AutomationStudioFuel3/')) return 'automationStudio'
  return null
}
const BEARER_APPS = new Set(['automationStudio', 'contactsMeta', 'contentBuilder'])

function response(status, body, { type = 'basic', headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    type,
    headers: new Headers(headers),
    text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }
}

/**
 * @param {object} o
 * @param {Array<{url: string, lastAccessed?: number}>} [o.tabs]  open browser tabs
 * @param {string[]} [o.loggedIn]    stacks with a login cookie
 * @param {string[]} [o.liveStacks]  stacks whose core API answers 200 (stack check)
 * @param {string[]} [o.mintable]    stacks where update-token.json yields a token
 * @param {object} [o.landings]      landing URL → app id it creates a session for
 * @param {object} [o.local], [o.session]  initial chrome.storage areas
 * @param {object|null} [o.currentBU]
 * @param {boolean} [o.loginPageWhenNoSession]  apps answer 200 with their login page instead of 401
 */
export async function loadSW(o = {}) {
  const sim = {
    tabs: o.tabs || [],
    loggedIn: new Set(o.loggedIn || []),
    liveStacks: new Set(o.liveStacks || o.loggedIn || []),
    mintable: new Set(o.mintable || []),
    landings: o.landings || {},
    sessions: new Set(o.sessions || []), // `${stack}:${appId}`
    tokens: new Set(), // valid MCA tokens
    tokenCount: 0,
    csrf: 'csrf-0',
    csrfCount: 0,
    rotateCsrfBeforeNextWrite: false,
    currentBU: o.currentBU ?? null,
    created: [],
    removed: [],
    fetched: [],
    apiStatus: null, // force every app API call to answer this status
    loginPageWhenNoSession: !!o.loginPageWhenNoSession,
  }
  const local = makeArea(o.local)
  const session = makeArea(o.session)
  const onMessage = event()
  const onBeforeRequest = event()
  const onBeforeSendHeaders = event()
  let nextTabId = 1000

  const chrome = {
    runtime: { onMessage, getManifest: () => ({ version: 'test' }), getURL: (p) => `chrome-extension://id/${p}`, lastError: undefined },
    storage: { local: local.api, session: session.api, onChanged: event() },
    tabs: {
      query: (q, cb) => setTimeout(() => cb(sim.tabs.map((t, i) => ({ id: i + 1, ...t }))), 0),
      get: (id, cb) => setTimeout(() => cb({ id, ...sim.tabs[id - 1] }), 0),
      create: (opts, cb) => {
        const id = nextTabId++
        sim.created.push({ url: opts.url, active: opts.active })
        setTimeout(() => {
          cb?.({ id })
          const u = new URL(opts.url.replace('#', '?'))
          const stack = u.hostname.split('.')[1]
          if (opts.url.includes('/AutomationStudioFuel3/update-token.json') && sim.mintable.has(stack)) {
            const token = `jwt-${stack}-${++sim.tokenCount}`
            sim.tokens.add(token)
            setTimeout(() => onMessage.fns.forEach((fn) => fn({ type: 'MCA_TOKEN_CAPTURED', accessToken: token }, { tab: { id } }, () => {})), 0)
          }
          const appId = sim.landings[opts.url]
          if (appId) sim.sessions.add(`${stack}:${appId}`)
        }, 0)
      },
      remove: (id, cb) => { sim.removed.push(id); setTimeout(() => cb?.(), 0) },
      update() {},
      onActivated: event(),
      onUpdated: event(),
    },
    windows: { update() {} },
    cookies: {
      getAll: (q, cb) => setTimeout(() => cb([...sim.loggedIn].map((s) => ({ name: 'platformAuthCookie', domain: `mc.${s}.exacttarget.com` }))), 0),
      get: ({ url, name }, cb) => setTimeout(() => {
        const host = new URL(url).hostname
        const stack = host.split('.')[1]
        if (name === 'platformAuthCookie') return cb(host.startsWith('mc.') && host.endsWith('.exacttarget.com') && sim.loggedIn.has(stack) ? { name, value: 'x' } : null)
        if (name === '_csrf' && host.startsWith('content-builder.')) return cb({ name, value: encodeURIComponent(sim.csrf) })
        cb(null)
      }, 0),
    },
    webRequest: { onBeforeRequest, onBeforeSendHeaders },
    action: { setIcon() {}, onClicked: event() },
  }

  const fetch = async (url, opts = {}) => {
    const headers = opts.headers || {}
    sim.fetched.push({ url, method: opts.method || 'GET', headers, body: opts.body })
    const u = new URL(url)
    const stack = u.hostname.split('.')[1]
    if (u.hostname.endsWith('.exacttarget.com')) {
      if (/\/platform-internal\/v1\/accounts\/@current$/.test(u.pathname)) {
        return sim.currentBU ? response(200, sim.currentBU) : response(0, null, { type: 'opaqueredirect' })
      }
      if (!sim.liveStacks.has(stack)) return response(0, null, { type: 'opaqueredirect' })
      if (sim.apiStatus) return response(sim.apiStatus, 'boom')
      return response(200, { ok: true, url }, { headers: { 'x-csrf-token': `core-${stack}` } })
    }
    if (u.pathname.endsWith('/update-token.json')) return response(0, null, { type: 'opaqueredirect' })
    const appId = appIdFor(u)
    const isCb = appId === 'contentBuilder'
    const write = (opts.method || 'GET') !== 'GET'
    if (isCb && write && sim.rotateCsrfBeforeNextWrite) {
      sim.rotateCsrfBeforeNextWrite = false
      sim.csrf = `csrf-${++sim.csrfCount}`
    }
    const bearer = (headers.Authorization || '').replace(/^Bearer /, '')
    const authed = sim.sessions.has(`${stack}:${appId}`) || (BEARER_APPS.has(appId) && sim.tokens.has(bearer))
    if (!authed) return sim.loginPageWhenNoSession ? response(200, '<!DOCTYPE html><html><head><title>Login</title></head><body>Sign in</body></html>') : response(401)
    if (isCb && write && headers['X-CSRF-Token'] !== sim.csrf) return response(403)
    if (isCb) sim.csrf = `csrf-${++sim.csrfCount}`
    if (sim.apiStatus) return response(sim.apiStatus, 'boom')
    return response(200, { ok: true, url })
  }

  vi.resetModules()
  globalThis.chrome = chrome
  globalThis.fetch = fetch
  await import('../index.js')
  const { timing } = await import('../sessions.js')
  const { mintTiming } = await import('../mcaToken.js')
  // Short, but with room for a busy machine (30 ms made the mint test flaky).
  Object.assign(timing, { pollMs: 2, landingTimeoutMs: 200, cooldownMs: 60000 })
  Object.assign(mintTiming, { timeoutMs: 300 })

  // Messages come from an extension page unless a test passes another sender.
  function send(message, sender = { url: 'chrome-extension://id/app.html' }) {
    return new Promise((resolve) => {
      let answered = false
      const reply = (r) => { if (!answered) { answered = true; resolve(r) } }
      for (const fn of [...onMessage.fns]) fn(message, sender, reply)
      setTimeout(() => reply(undefined), 3000)
    })
  }

  // Sends a Query Studio run to the webRequest listeners whose URL filter matches.
  async function captureQuery(sql, timeStamp = 1700000000000, { url = 'https://querystudio.herokuapp.com/query/create', extra = {} } = {}) {
    const bytes = new TextEncoder().encode(JSON.stringify({ querytext: sql, ...extra }))
    const glob = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.?+^$()[\]{}|\\]/g, '\\$&')).join('.*') + '$')
    for (const fn of onBeforeRequest.fns) {
      const urls = onBeforeRequest.filters.get(fn)?.urls
      if (urls && !urls.some((p) => glob(p).test(url))) continue
      await fn({ method: 'POST', url, timeStamp, requestBody: { raw: [{ bytes }] } })
    }
  }

  return { sim, send, captureQuery, local: local.data, session: session.data, onBeforeRequest, onBeforeSendHeaders }
}

export const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms))
