// MCA Bearer token vault (from SFMC Query Saver, verified live 2026-09-22).
//
// mc.*.marketingcloudapps.com and content-builder.* want `Authorization: Bearer <JWT>`.
// The JWT comes from update-token.json, which 302s through a silent OAuth hop without
// CORS headers: fetch() can't follow it, a real navigation can. So the token is minted
// in an inactive tab; content.js reads the JSON and reports MCA_TOKEN_CAPTURED, and
// the tab is closed.

import { createTab, removeTab } from './chromeAsync.js'

export const mintTiming = { timeoutMs: 10000, backoffMs: 2 * 60 * 1000, renewMs: 15000 }

const tokenCache = {} // { [stack]: { accessToken, expiresAt } }
const inFlight = {} // { [stack]: Promise<string|null> }
const failedAt = {} // { [stack]: ms }
const pendingByTab = new Map() // tabId → resolve

let onMintFailure = () => {}
export function setOnMintFailure(fn) { onMintFailure = fn }

export function mintBackoff(stack) {
  return Date.now() - (failedAt[stack] || 0) < mintTiming.backoffMs
}

/**
 * Ends the pause after a failed mint, for one stack or (no stack) all of them. Called when
 * a logged-in SFMC page loads (feedback #1104: after logging in again, Retry kept saying
 * "No Marketing Cloud session for SOAP" for up to 2 minutes).
 */
export function clearMintBackoff(stack) {
  if (stack) delete failedAt[stack]
  else for (const k of Object.keys(failedAt)) delete failedAt[k]
}

const LOGIN_PAGE = /^https:\/\/[^/]*(?:mc\.login\.|\/login|login\.)/i

/**
 * tabs.onUpdated for a tab this module opened: when the token address sends it to the
 * login page, there is no session, so the mint fails now instead of after the timeout.
 */
export function handleMintTabUpdate(tabId, url) {
  const finish = pendingByTab.get(tabId)
  if (finish && LOGIN_PAGE.test(String(url || ''))) finish(null)
}
export const isMintTab = (tabId) => pendingByTab.has(tabId) || renewTabs.has(tabId)

// ── Renewing a refused token ──────────────────────────────
// After logging in again, update-token.json kept handing out the old session's token,
// which SOAP refused ("Login Failed"), until Automation Studio was opened in SFMC (seen
// live on s10, 2026-11-17, feedback #1104 follow-up). The shell loads the app at
// /AutomationStudioFuel3/?hub=1&ks=ks; opened in a tab, that address signs the app in
// again (authorize, SFMC login with the session cookie, auth_redirect with a code), after
// which SOAP accepted the token. Its root and /login alone do not (they keep the session).
const renewTabs = new Map() // tabId → resolve
const renewing = {} // { [stack]: Promise<string|null> }
const APP_PAGE = /^https:\/\/mc\.[^/]+\.marketingcloudapps\.com\/AutomationStudioFuel3\//i
export const appSignInUrl = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/?hub=1&ks=ks`

/** tabs.onUpdated for a renewal tab: done once a page of the app has loaded; the login page means no session. */
export function handleRenewTabUpdate(tabId, info, tab) {
  const done = renewTabs.get(tabId)
  if (!done) return
  const url = String(tab?.url || info?.url || '')
  if (LOGIN_PAGE.test(url)) return done('login')
  if (info?.status === 'complete' && APP_PAGE.test(url)) done('ok')
}

function openAppSignIn(stack) {
  return new Promise((resolve) => {
    let tabId = null
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (tabId != null) { renewTabs.delete(tabId); removeTab(tabId) }
      resolve(result)
    }
    const timer = setTimeout(() => finish('timeout'), mintTiming.renewMs)
    createTab({ url: appSignInUrl(stack), active: false }).then((tab) => {
      if (!tab) return finish('no tab')
      tabId = tab.id
      if (settled) return removeTab(tabId)
      renewTabs.set(tabId, finish)
    })
  })
}

/**
 * A new token after SFMC refused the cached one: drops it, lets Automation Studio sign in
 * again in an inactive tab (appSignInUrl), then mints. Null when that fails (no session: log in).
 */
export function renewMcaToken(stack) {
  if (!stack) return Promise.resolve(null)
  if (renewing[stack]) return renewing[stack]
  renewing[stack] = (async () => {
    dropMcaToken(stack)
    const result = await openAppSignIn(stack)
    if (result === 'login') return null
    delete failedAt[stack]
    return getMcaToken(stack)
  })().finally(() => { delete renewing[stack] })
  return renewing[stack]
}

export function isMcaTokenReady(stack) {
  const cached = stack && tokenCache[stack]
  return !!cached && Date.now() < cached.expiresAt
}

export function dropMcaToken(stack) {
  delete tokenCache[stack]
}

export function decodeJwtExp(jwt) {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(payload + '==='.slice((payload.length + 3) % 4)))
    return json.exp ? json.exp * 1000 : null
  } catch {
    return null
  }
}

// MCA_TOKEN_CAPTURED from content.js. Only the tab this module opened counts.
export function handleCapturedToken(sender, accessToken) {
  const resolve = pendingByTab.get(sender?.tab?.id)
  if (resolve) resolve(accessToken || null)
}

function mint(stack) {
  if (inFlight[stack]) return inFlight[stack]
  const promise = new Promise((resolve) => {
    let settled = false
    let tabId = null
    const finish = (token) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (tabId != null) { pendingByTab.delete(tabId); removeTab(tabId) }
      resolve(token)
    }
    const timer = setTimeout(() => {
      console.warn('[Toolkit:SW] MCA token mint timed out for stack:', stack)
      finish(null)
    }, mintTiming.timeoutMs)
    createTab({ url: `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/update-token.json`, active: false })
      .then((tab) => {
        if (!tab) return finish(null)
        tabId = tab.id
        if (settled) return removeTab(tabId)
        pendingByTab.set(tabId, finish)
      })
  }).finally(() => { delete inFlight[stack] })
  inFlight[stack] = promise
  return promise
}

export async function getMcaToken(stack) {
  if (!stack) return null
  if (isMcaTokenReady(stack)) return tokenCache[stack].accessToken
  // A failed mint opened a tab for nothing; don't open another on every call.
  if (mintBackoff(stack)) return null
  const accessToken = await mint(stack)
  if (!accessToken) {
    failedAt[stack] = Date.now()
    onMintFailure(stack)
    return null
  }
  delete failedAt[stack]
  const expiresAt = (decodeJwtExp(accessToken) || Date.now() + 10 * 60 * 1000) - 30000
  tokenCache[stack] = { accessToken, expiresAt }
  return accessToken
}
