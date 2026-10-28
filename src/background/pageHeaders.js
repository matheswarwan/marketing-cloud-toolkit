// Contact Builder's contacts calls (count, search, a contact's details) are refused
// with 403 "Not Authorized" unless they carry the headers Contact Builder's own page
// sends (feedbacks #60, #67; the user's request captures, 2026-10-25): its
// `authorization` value (not the minted MCA token), `X-CSRF-Token`, `X-Requested-With`
// and `tz`. None of them can be fetched, so they are read here from the page's own
// requests to contactsmeta (webRequest), kept per stack in memory and session storage
// (gone when the browser closes), and never logged. When none have been seen, a
// Contact Builder page is opened in an inactive tab so it makes those requests.

import { policyNow } from './policy.js'
import { storageGet, storageSet, createTab, removeTab } from './chromeAsync.js'

const MAX_AGE = 30 * 60 * 1000
const KEY = '_cbPageHeaders'
const cache = {} // { [stack]: { authorization, csrf, tz, capturedAt, csrfAt } }

/** contactsmeta paths that need the page's headers. */
export function needsPageHeaders(url) {
  return /\/contactsmeta\/fuelapi\/(contacts(-internal)?\/|legacy\/v1\/beta\/contact\/)/i.test(String(url || ''))
}

const stackOf = (url) => String(url || '').match(/^https:\/\/mc\.([^.]+)\.marketingcloudapps\.com\/contactsmeta\//i)?.[1]?.toLowerCase() || null

export async function restorePageHeaders() {
  try {
    const { [KEY]: stored = {} } = await storageGet('session', KEY)
    const now = Date.now()
    for (const [stack, e] of Object.entries(stored)) if (e && now - (e.capturedAt || 0) < MAX_AGE) cache[stack] = e
  } catch { /* no session storage */ }
}

async function persist() {
  try { await storageSet('session', { [KEY]: cache }) } catch { /* ignore */ }
}

/**
 * webRequest.onBeforeSendHeaders listener for contactsmeta. Only SFMC's own page
 * requests count (the extension's requests have no tab, or the extension's origin).
 */
export function sniffPageHeaders(details) {
  if (!details?.requestHeaders || details.tabId < 0) return
  if (policyNow().disableContacts) return // Contacts turned off by policy: nothing to read
  if (String(details.initiator || '').startsWith('chrome-extension://')) return
  const stack = stackOf(details.url)
  if (!stack) return
  const get = (n) => details.requestHeaders.find((h) => h.name.toLowerCase() === n)?.value || null
  const authorization = get('authorization')
  const csrf = get('x-csrf-token')
  const tz = get('tz')
  if (!authorization && !csrf) return
  const prev = cache[stack] || {}
  const now = Date.now()
  cache[stack] = {
    authorization: authorization || prev.authorization || null,
    csrf: csrf || prev.csrf || null,
    tz: tz || prev.tz || null,
    capturedAt: now,
    csrfAt: csrf ? now : prev.csrfAt || 0,
  }
  persist()
}

/** The headers to send for a contacts call, or null when none are known. */
export function pageHeadersFor(stack) {
  const e = stack && cache[stack]
  if (!e || Date.now() - e.capturedAt > MAX_AGE) return null
  const h = { 'X-Requested-With': 'XMLHttpRequest' }
  if (e.authorization) h.Authorization = e.authorization
  if (e.csrf && Date.now() - e.csrfAt < MAX_AGE) h['X-CSRF-Token'] = e.csrf
  if (e.tz) h.tz = e.tz
  return h
}

export function dropPageHeaders(stack) {
  delete cache[stack]
  persist()
}

export const pageTiming = { waitMs: 20000, pollMs: 500 }
const inFlight = new Map()

/**
 * Opens Contact Builder's All Contacts screen in an inactive tab until its requests
 * have shown the headers (a CSRF token when `needCsrf`), then closes it. Resolves to
 * the headers or null. One at a time per stack.
 */
export function capturePageHeaders(stack, { needCsrf = true } = {}) {
  if (inFlight.has(stack)) return inFlight.get(stack)
  const ok = () => { const h = pageHeadersFor(stack); return h && h.Authorization && (!needCsrf || h['X-CSRF-Token']) ? h : null }
  const p = (async () => {
    if (ok()) return ok()
    const tab = await createTab({ url: `https://mc.${stack}.marketingcloudapps.com/contactsmeta/admin.html#admin/all-contacts`, active: false })
    if (!tab) return null
    try {
      const deadline = Date.now() + pageTiming.waitMs
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pageTiming.pollMs))
        if (ok()) return ok()
      }
      return pageHeadersFor(stack)
    } finally {
      removeTab(tab.id)
    }
  })().finally(() => inFlight.delete(stack))
  inFlight.set(stack, p)
  return p
}
