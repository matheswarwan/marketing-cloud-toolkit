// Every SFMC API call goes through here (message SFMC_FETCH). Extension pages can't
// send SFMC cookies themselves; the service worker can, thanks to host_permissions.
//
// 1. core (exacttarget.com): cookies, plus the captured core CSRF on mutating calls.
// 2. mca apps that take a Bearer token: the minted MCA token, plus the app's `_csrf`
//    cookie on mutating calls (re-read once after a 403, since it rotates).
// 3. When the response says "no session" (401, or a redirect into SSO): a stale
//    Bearer token is re-minted once; then the app's session is warmed up in an
//    inactive tab and the call retried once (sessions.js).
// 4. Still no session: the stack is forgotten and the call fails with LOGIN_REQUIRED.
//
// An app without a session can also answer 200 with its login web page instead of
// data (feedback #93: searches came back empty). That counts as "no session" too;
// when it stays that way, the call fails with SESSION_UNAVAILABLE. Errors carry
// `app` ({ id, name, url }) so pages can offer Retry and a link to log in.

import { resolveUrl } from './apps.js'
import { getCoreCsrf, getAppCsrf, rememberCsrf } from './csrf.js'
import { getMcaToken, dropMcaToken } from './mcaToken.js'
import { ensureSession, SfmcAuthError, LOGIN_REQUIRED, SESSION_UNAVAILABLE } from './sessions.js'
import { forgetStack } from './stack.js'
import { needsPageHeaders, pageHeadersFor, capturePageHeaders, dropPageHeaders } from './pageHeaders.js'

/**
 * SFMC's own HTML error pages (IIS "403 Not Authorized") turned into their title,
 * so a message reads "Not Authorized" instead of a page of markup (feedback #67).
 */
export function errorText(text) {
  const t = String(text ?? '')
  if (!/^\s*(<!DOCTYPE html|<html)/i.test(t)) return t
  const pick = (tag) => (t.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return pick('title') || pick('h1') || 'SFMC returned an error page'
}

export class SfmcApiError extends Error {
  constructor(status, text) {
    super(`SFMC API error ${status}: ${errorText(text).substring(0, 300)}`)
    this.status = status
  }
}

// A web page where an API answer was expected (SFMC's login or app shell).
export function isWebPage(text) {
  return /^\s*(<!DOCTYPE html|<html)/i.test(String(text ?? ''))
}

const needsSession = (res) => res.status === 401 || res.type === 'opaqueredirect' || res.webPage

// The app an error came from, with the SFMC page to log in to it.
function appInfo(app, stack) {
  const cloud = stack ? `https://mc.${stack}.exacttarget.com/cloud/` : null
  if (!app) return { id: null, name: 'Marketing Cloud', url: cloud }
  const url = (stack && app.landings(stack).find((u) => u.includes('.exacttarget.com/cloud/'))) || cloud
  return { id: app.id, name: app.name, url }
}

async function send(url, method, body, headers) {
  const opts = {
    method,
    credentials: 'include',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body != null) opts.body = typeof body === 'string' ? body : JSON.stringify(body)
  try {
    const r = await fetch(url, opts)
    const body = await r.text().catch(() => '')
    return { ok: r.ok, status: r.status, type: r.type, headers: r.headers, body, webPage: r.ok && isWebPage(body) }
  } catch (err) {
    return { ok: false, status: 0, type: 'error', headers: new Headers(), body: err.message, webPage: false }
  }
}

async function authHeaders({ url, stack, family, app, mutating }) {
  const headers = {}
  // Contact Builder's contacts calls take its page's own headers (pageHeaders.js).
  if (family === 'mca' && stack && needsPageHeaders(url)) {
    let ph = pageHeadersFor(stack)
    if (!ph?.Authorization || (mutating && !ph['X-CSRF-Token'])) ph = (await capturePageHeaders(stack, { needCsrf: mutating })) || ph
    if (ph?.Authorization) return { ...ph }
  }
  if (family === 'core') {
    const csrf = mutating && getCoreCsrf(stack)
    if (csrf) headers['X-CSRF-Token'] = csrf
  } else if (family === 'mca') {
    if (app?.bearer) {
      const token = await getMcaToken(stack)
      if (token) headers.Authorization = `Bearer ${token}`
    }
    if (mutating) {
      const csrf = await getAppCsrf(url, app?.csrfCookie || '_csrf')
      if (csrf) headers['X-CSRF-Token'] = csrf
    }
  }
  return headers
}

export async function sfmcFetch(request) {
  const { stack, app } = resolveUrl(request.url)
  try {
    return await fetchWithSession(request)
  } catch (err) {
    if (err && typeof err === 'object' && !err.app) err.app = appInfo(app, stack)
    throw err
  }
}

async function fetchWithSession({ url, method = 'GET', body = null, bootstrap = true }) {
  const target = { url, ...resolveUrl(url), mutating: method !== 'GET' && method !== 'HEAD' }
  const { stack, family, app } = target

  let headers = await authHeaders(target)
  let res = await send(url, method, body, headers)

  if (res.status === 403 && family === 'mca' && headers['X-CSRF-Token']) {
    // A contacts call: the page's headers may be stale; read them again once.
    if (needsPageHeaders(url) && headers['X-Requested-With']) dropPageHeaders(stack)
    headers = await authHeaders(target)
    res = await send(url, method, body, headers)
  }

  if (needsSession(res) && app?.bearer && headers.Authorization) {
    dropMcaToken(stack)
    headers = await authHeaders(target)
    if (headers.Authorization) res = await send(url, method, body, headers)
  }

  if (needsSession(res) && app && stack && bootstrap) {
    await ensureSession(app, stack, { onLoggedOut: forgetStack })
    headers = await authHeaders(target)
    res = await send(url, method, body, headers)
  }

  if (res.webPage) {
    throw new SfmcAuthError(SESSION_UNAVAILABLE,
      `${app?.name || 'SFMC'} sent a web page (its login) instead of data, so it has no session.`)
  }
  if (needsSession(res)) {
    await forgetStack(stack)
    throw new SfmcAuthError(LOGIN_REQUIRED,
      'SFMC session expired (401). Please log in to SFMC in any tab, then try again.')
  }

  const text = res.body
  if (family === 'core' && stack) {
    const fresh = res.headers?.get?.('x-csrf-token')
    if (fresh) rememberCsrf(stack, fresh)
  }
  if (!res.ok) throw new SfmcApiError(res.status, text)
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}
