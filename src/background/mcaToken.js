// MCA Bearer token vault (from SFMC Query Saver, verified live 2026-09-22).
//
// mc.*.marketingcloudapps.com and content-builder.* want `Authorization: Bearer <JWT>`.
// The JWT comes from update-token.json, which 302s through a silent OAuth hop without
// CORS headers: fetch() can't follow it, a real navigation can. So the token is minted
// in an inactive tab; content.js reads the JSON and reports MCA_TOKEN_CAPTURED, and
// the tab is closed.

import { createTab, removeTab } from './chromeAsync.js'

export const mintTiming = { timeoutMs: 10000, backoffMs: 2 * 60 * 1000 }

const tokenCache = {} // { [stack]: { accessToken, expiresAt } }
const inFlight = {} // { [stack]: Promise<string|null> }
const failedAt = {} // { [stack]: ms }
const pendingByTab = new Map() // tabId → resolve

let onMintFailure = () => {}
export function setOnMintFailure(fn) { onMintFailure = fn }

export function mintBackoff(stack) {
  return Date.now() - (failedAt[stack] || 0) < mintTiming.backoffMs
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
