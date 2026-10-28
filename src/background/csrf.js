// Core (exacttarget.com) CSRF tokens.
//
// There is no known way to fetch one (tried live in SFMC Query Saver, 2026-09-22): the
// token only shows up as a request header on the user's own mutating calls, so it is
// captured passively here and kept per stack for 14 minutes. It is scoped to
// exacttarget.com: marketingcloudapps.com apps use their own `_csrf` cookie and must
// never write into this cache.
//
// Kept in memory and chrome.storage.session (memory only, cleared when the browser
// closes), so a restarted service worker still has it; never in chrome.storage.local
// (security review, 2026-10-28). Older versions kept it in local: removed on load.

import { storageGet, storageSet, storageRemove, getCookie } from './chromeAsync.js'

const MAX_AGE = 14 * 60 * 1000
const csrfCache = {} // { [stack]: { token, capturedAt } }

export async function restoreCsrfTokens() {
  storageRemove('local', '_csrfTokens')
  const { _csrfTokens: stored = {} } = await storageGet('session', '_csrfTokens')
  const now = Date.now()
  for (const [stack, entry] of Object.entries(stored)) {
    if (entry?.csrfToken && now - (entry.csrfCapturedAt || 0) < MAX_AGE) {
      csrfCache[stack] = { token: entry.csrfToken, capturedAt: entry.csrfCapturedAt }
    }
  }
}

export async function rememberCsrf(stack, token) {
  if (!stack || !token || token === csrfCache[stack]?.token) return
  const capturedAt = Date.now()
  csrfCache[stack] = { token, capturedAt }
  const { _csrfTokens: stored = {} } = await storageGet('session', '_csrfTokens')
  stored[stack] = { csrfToken: token, csrfCapturedAt: capturedAt }
  await storageSet('session', { _csrfTokens: stored })
}

export function getCoreCsrf(stack) {
  const entry = stack && csrfCache[stack]
  return entry && Date.now() - entry.capturedAt < MAX_AGE ? entry.token : null
}

// webRequest.onBeforeSendHeaders listener for https://*.exacttarget.com/*
export function sniffCsrf(details) {
  if (!details.requestHeaders) return
  const m = details.url.match(/(?:mc|members)\.([^.]+)\.exacttarget\.com/)
  if (!m) return
  const h = details.requestHeaders.find((x) => x.name.toLowerCase() === 'x-csrf-token')
  if (h?.value) rememberCsrf(m[1], h.value)
}

// Double-submit cookie of a marketingcloudapps.com app (Content Builder: `_csrf`).
// It rotates on every response, so callers re-read it after a 403.
export async function getAppCsrf(rawUrl, cookieName = '_csrf') {
  try {
    const cookie = await getCookie({ url: new URL(rawUrl).origin + '/', name: cookieName })
    if (!cookie?.value) return null
    try { return decodeURIComponent(cookie.value) } catch { return cookie.value }
  } catch {
    return null
  }
}
