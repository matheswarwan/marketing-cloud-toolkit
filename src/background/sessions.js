// Per-app session warm-up (from SFMC Automation Viewer's sfmcAuth.js, verified live
// on s10). Being logged in to Marketing Cloud does not give every app a session;
// opening the app does. When a marketingcloudapps.com call needs a session, the app's
// landing page is opened in an inactive tab until its probe URL answers 200, then
// the tab is closed and the call is retried once.

import { SFMC_APPS, findApp } from './apps.js'
import { createTab, removeTab, getCookie, delay } from './chromeAsync.js'

export const LOGIN_REQUIRED = 'SFMC_LOGIN_REQUIRED'
export const SESSION_UNAVAILABLE = 'SFMC_SESSION_UNAVAILABLE'

export const timing = { pollMs: 1000, landingTimeoutMs: 15000, cooldownMs: 30000 }

const LOGIN_COOKIES = [
  { host: (s) => `mc.${s}.exacttarget.com`, name: 'platformAuthCookie' },
  { host: (s) => `members.${s}.exacttarget.com`, name: 'ETAuthCookie' },
]

const inFlight = new Map()
const failedAt = new Map()
const starting = new Set() // `${stack}:${appId}` being started by warmUpMissing
const warmedAt = new Map() // stack → when warmUpMissing last ran
export const WARM_UP_EVERY = 10 * 60 * 1000

export class SfmcAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export async function isLoggedIn(stack) {
  for (const c of LOGIN_COOKIES) {
    if (await getCookie({ url: `https://${c.host(stack)}/`, name: c.name })) return true
  }
  return false
}

export async function probeSession(app, stack) {
  try {
    const res = await fetch(app.probeUrl(stack), { credentials: 'include', redirect: 'manual' })
    return res.status === 200
  } catch {
    return false
  }
}

async function tryLanding(app, stack, landingUrl) {
  const tab = await createTab({ url: landingUrl, active: false })
  if (!tab) return false
  try {
    const deadline = Date.now() + timing.landingTimeoutMs
    while (Date.now() < deadline) {
      await delay(timing.pollMs)
      if (await probeSession(app, stack)) return true
    }
    return false
  } finally {
    removeTab(tab.id)
  }
}

// One warm-up per app and stack at a time; concurrent callers share it. After a
// failure, fail fast for a while instead of opening a tab on every call.
export function ensureSession(app, stack, { onLoggedOut } = {}) {
  const key = `${stack}:${app.id}`
  if (inFlight.has(key)) return inFlight.get(key)
  const last = failedAt.get(key)
  if (last && Date.now() - last < timing.cooldownMs) {
    return Promise.reject(new SfmcAuthError(SESSION_UNAVAILABLE, `Could not start a ${app.name} session on stack ${stack}.`))
  }
  const promise = (async () => {
    if (await probeSession(app, stack)) return
    if (!(await isLoggedIn(stack))) {
      await onLoggedOut?.(stack)
      throw new SfmcAuthError(LOGIN_REQUIRED, `Not logged in to Marketing Cloud on stack ${stack}.`)
    }
    for (const url of app.landings(stack)) {
      if (await tryLanding(app, stack, url)) return
    }
    throw new SfmcAuthError(SESSION_UNAVAILABLE, `Could not start a ${app.name} session on stack ${stack}.`)
  })()
    .then(() => { failedAt.delete(key) })
    .catch((err) => { failedAt.set(key, Date.now()); throw err })
    .finally(() => { inFlight.delete(key) })
  inFlight.set(key, promise)
  return promise
}

// Session status per app, for the connection menu. Never opens a tab.
export async function sessionStatus(stack) {
  const loggedIn = await isLoggedIn(stack)
  const apps = await Promise.all(SFMC_APPS.filter((app) => !app.onDemand).map(async (app) => ({
    id: app.id,
    name: app.name,
    ok: loggedIn && (await probeSession(app, stack)),
    starting: starting.has(`${stack}:${app.id}`),
  })))
  return { stack, loggedIn, apps }
}

export async function connectApp(stack, appId, opts) {
  const app = findApp(appId)
  if (!app) throw new Error(`Unknown SFMC app: ${appId}`)
  failedAt.delete(`${stack}:${app.id}`)
  await ensureSession(app, stack, opts)
}

/**
 * Starts the app sessions that are missing, but only when at least one app already
 * has a session: then the user is logged in and SFMC answers, so the rest can be
 * started. With none, the user is most likely not logged in and opening tabs would
 * not help. Apps are started one at a time (one inactive tab each), at most once
 * every 10 minutes per stack unless `force`.
 * @returns {{ skipped?: string, started?: string[], failed?: string[] }}
 */
export async function warmUpMissing(stack, { force = false, onLoggedOut } = {}) {
  if (!stack) return { skipped: 'no stack' }
  const last = warmedAt.get(stack)
  if (!force && last && Date.now() - last < WARM_UP_EVERY) return { skipped: 'recently' }
  const status = await sessionStatus(stack)
  if (!status.loggedIn) return { skipped: 'not logged in' }
  if (!status.apps.some((a) => a.ok)) return { skipped: 'no app session' }
  warmedAt.set(stack, Date.now())
  const missing = status.apps.filter((a) => !a.ok).map((a) => findApp(a.id))
  const started = []
  const failed = []
  for (const app of missing) starting.add(`${stack}:${app.id}`)
  try {
    for (const app of missing) {
      try {
        failedAt.delete(`${stack}:${app.id}`)
        await ensureSession(app, stack, { onLoggedOut })
        started.push(app.id)
      } catch (e) {
        failed.push(app.id)
        if (e.code === LOGIN_REQUIRED) break
      } finally {
        starting.delete(`${stack}:${app.id}`)
      }
    }
  } finally {
    for (const app of missing) starting.delete(`${stack}:${app.id}`)
  }
  return { started, failed }
}
