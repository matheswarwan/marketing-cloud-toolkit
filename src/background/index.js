// Marketing Cloud Toolkit service worker: wires the modules to chrome events and messages.
//
// Messages (all `{ type, ... }`):
//   GET_SESSION, GET_STACKS, SET_STACK_OVERRIDE      stack resolution (stack.js)
//   GET_CONNECTION_STATUS                             stack, MCA token, open SFMC tabs
//   SFMC_SESSION_STATUS { stack }                     per-app sessions, never opens a tab
//   SFMC_CONNECT_APP { stack, appId }                 warm up one app's session
//   SFMC_WARM_UP { stack, force }                     start the missing app sessions when at least one exists
//   SFMC_FETCH { url, method, body, bootstrap }       → { data } or { error, code, status }
//   SAVE_RECORDS { records }, RENAME_QUERY { id, name }, IMPORT_SHARED_QUERY { records }
//   WATCH_CHECK { stack, force }, WATCH_BADGE          watched automations (watches.js)
//   OPEN_APP { path }                                 open app.html#<path> (Automation Summary tab, dashboard card)
//   DASHBOARD_SUMMARY { stack, force }                automations and journeys for the dashboard card (dashboard.js)
//   OPEN_SFMC_LINK { url }                            open an SFMC deep link and keep it (deepLinks.js)
//   SFMC_CONTEXT_CAPTURED, MCA_TOKEN_CAPTURED         from content.js
//   PING

import {
  rememberActiveStack, noteRequestStack, resolveAndPublish, getStacks, setStackOverride,
  captureContext, getSession, forgetStack, onForgetStack,
} from './stack.js'
import { restoreCsrfTokens, sniffCsrf, getCoreCsrf } from './csrf.js'
import { restorePageHeaders, sniffPageHeaders } from './pageHeaders.js'
import {
  getMcaToken, isMcaTokenReady, mintBackoff, dropMcaToken, handleCapturedToken, setOnMintFailure,
} from './mcaToken.js'
import { sessionStatus, connectApp, warmUpMissing } from './sessions.js'
import { sfmcFetch } from './fetchProxy.js'
import {
  saveRecords, renameQuery, captureQueryStudio, captureEmail, loadEmailSaverPrefs, applyEmailSaverPrefs,
} from './capture.js'
import { queryTabs, createTab, storageGet } from './chromeAsync.js'
import { nextTo } from '../utils/openTab.js'
import { openSfmcLink } from './deepLinks.js'
import { QUERY_STUDIO_CREATE_URLS } from '../utils/queryStudio.js'
import { watchPolicy, getPolicy } from './policy.js'
import { sharedQueryRecords } from './sharedImport.js'
import { messageAllowed } from './senders.js'
import { makeRoom } from './storageRoom.js'
import { watchForUpdates } from './updates.js'
import { checkWatches, updateBadge } from './watches.js'
import { getDashboardSummary } from './dashboard.js'
import { captureActivity, activitySaveCompleted } from './activityCapture.js'

onForgetStack(dropMcaToken)
setOnMintFailure(forgetStack)
restoreCsrfTokens()
restorePageHeaders()
loadEmailSaverPrefs()
watchForUpdates()
watchPolicy()
// Without unlimitedStorage, an install that grew past the 10 MB limit drops old email versions.
chrome.runtime.onInstalled?.addListener(() => { makeRoom(0) })
updateBadge()

const APP_PAGE = 'app.html'

// The toolbar icon opens the app in a new tab each time; several tabs can be open
// (each keeps its own workspace and Query Builder query, see utils/tabClaims.js).
chrome.action?.onClicked?.addListener((tab) => {
  createTab(nextTo(tab, { url: chrome.runtime.getURL(APP_PAGE) }))
})

chrome.tabs?.onActivated?.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => { if (!chrome.runtime.lastError && tab) rememberActiveStack(tab.url, tab.id) })
})
chrome.tabs?.onUpdated?.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab?.active) rememberActiveStack(tab.url, tab.id)
})

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return
  const prefs = {}
  for (const k of ['_emailSaverEnabled', '_emailSaveDebounce']) if (k in changes) prefs[k] = changes[k].newValue
  applyEmailSaverPrefs(prefs)
})

// The stack of stackless pages (mc.exacttarget.com, feedback #76): see stack.js.
chrome.webRequest?.onBeforeRequest.addListener(
  noteRequestStack, { urls: ['https://*.exacttarget.com/*', 'https://*.marketingcloudapps.com/*'] })
chrome.webRequest?.onBeforeSendHeaders.addListener(
  sniffCsrf, { urls: ['https://*.exacttarget.com/*'] }, ['requestHeaders', 'extraHeaders'])
// Contact Builder's own headers for the contacts calls (pageHeaders.js).
chrome.webRequest?.onBeforeSendHeaders.addListener(
  sniffPageHeaders, { urls: ['https://*.marketingcloudapps.com/contactsmeta/*'] }, ['requestHeaders', 'extraHeaders'])
// Query Studio 2's host is an optional permission; Chrome only delivers its
// requests once the user has granted it (Settings > Running queries).
chrome.webRequest?.onBeforeRequest.addListener(
  captureQueryStudio, { urls: QUERY_STUDIO_CREATE_URLS }, ['requestBody'])
chrome.webRequest?.onBeforeRequest.addListener(
  captureEmail, { urls: ['https://*.marketingcloudapps.com/fuelapi/asset/v1/content/assets/*'] }, ['requestBody'])
// Query and Script activities saved in Automation Studio (feedback #122).
// Automation Studio may also be served under exacttarget.com (feedback #129).
const ACTIVITY_URLS = ['https://*.marketingcloudapps.com/AutomationStudioFuel3/*', 'https://*.exacttarget.com/*AutomationStudioFuel3/*']
chrome.webRequest?.onBeforeRequest.addListener(captureActivity, { urls: ACTIVITY_URLS }, ['requestBody'])
chrome.webRequest?.onCompleted?.addListener(activitySaveCompleted, { urls: ACTIVITY_URLS })
chrome.webRequest?.onErrorOccurred?.addListener(activitySaveCompleted, { urls: ACTIVITY_URLS })

const isSfmcUrl = (u) => /^https:\/\/[^/]*\.(exacttarget|marketingcloudapps|marketingcloud|salesforce-marketingcloud)\.com\//.test(u || '')
const isLoggedInUrl = (u) => !u.includes('/login') && !u.includes('mc.login.') && !u.includes('sso')

export async function connectionStatus() {
  const { stack } = await resolveAndPublish()
  // Pre-warm the MCA token so it is ready before the user needs it.
  if (stack && !isMcaTokenReady(stack) && !mintBackoff(stack)) getMcaToken(stack)
  let coreOpen = false
  let contentBuilderOpen = false
  for (const t of await queryTabs({})) {
    const u = t.url || ''
    if (!isSfmcUrl(u) || !isLoggedInUrl(u)) continue
    if (u.includes('content-builder.')) contentBuilderOpen = true
    else if (u.includes('mc.') || u.includes('members.')) coreOpen = true
  }
  return {
    stack,
    connected: !!stack,
    tokenReady: !!getCoreCsrf(stack),
    mcaTokenReady: isMcaTokenReady(stack),
    areas: { core: { open: coreOpen }, contentBuilder: { open: contentBuilderOpen } },
  }
}

function errorReply(err) {
  return { error: err?.message || String(err), code: err?.code || null, status: err?.status ?? null, app: err?.app || null }
}

const handlers = {
  PING: () => ({ ok: true }),
  GET_SESSION: (m) => getSession(m.stackKey),
  GET_STACKS: () => getStacks(),
  SET_STACK_OVERRIDE: (m) => setStackOverride(m.stack),
  GET_CONNECTION_STATUS: () => connectionStatus(),
  SFMC_SESSION_STATUS: async (m) => ({ status: await sessionStatus(m.stack || (await resolveAndPublish()).stack) }),
  SFMC_CONNECT_APP: async (m) => {
    await connectApp(m.stack, m.appId, { onLoggedOut: forgetStack })
    return { ok: true }
  },
  SFMC_WARM_UP: async (m) => {
    // Settings switch "Start the other app sessions" (on unless turned off).
    const { _autoStartSessions } = await storageGet('local', ['_autoStartSessions'])
    if (_autoStartSessions === false && !m.force) return { result: { skipped: 'turned off' } }
    const stack = m.stack || (await resolveAndPublish()).stack
    return { result: await warmUpMissing(stack, { force: !!m.force, onLoggedOut: forgetStack }) }
  },
  SFMC_FETCH: async (m) => ({ data: await sfmcFetch(m) }),
  SAVE_RECORDS: async (m) => { await saveRecords(m.records || {}); return { status: 'OK' } },
  // From share-handler.js on a share page only: one query record, known fields only.
  IMPORT_SHARED_QUERY: async (m, sender) => {
    const records = sharedQueryRecords(m.records, sender?.url)
    if (!records) return { error: 'Not a share page or not a query.' }
    if ((await getPolicy()).disableShare) return { error: 'Sharing is turned off by policy.' }
    await saveRecords(records)
    return { status: 'OK' }
  },
  RENAME_QUERY: async (m) => { await renameQuery(m.id, m.name); return { status: 'OK' } },
  SFMC_CONTEXT_CAPTURED: (m) => {
    captureContext(m.context)
    // An SFMC page loaded: check watched automations (at most every 15 minutes).
    if (m.context?.stackKey) checkWatches(m.context.stackKey).catch(() => undefined)
    return null
  },
  WATCH_CHECK: async (m) => ({ result: await checkWatches(m.stack || (await resolveAndPublish()).stack, { force: !!m.force }) }),
  WATCH_BADGE: async () => { await updateBadge(); return { ok: true } },
  // From the Automation Summary tab on Automation Studio pages (public/automationPanel.js).
  OPEN_APP: (m, sender) => {
    const path = typeof m.path === 'string' && m.path.startsWith('/') ? m.path : '/'
    createTab(nextTo(sender?.tab, { url: chrome.runtime.getURL(`${APP_PAGE}#${path}`) }))
    return { ok: true }
  },
  // From the Marketing Cloud Toolkit card on SFMC's dashboard page (public/dashboardPanel.js, feedback #65).
  DASHBOARD_SUMMARY: async (m) => ({ summary: await getDashboardSummary(m.stack, { force: !!m.force }) }),
  OPEN_SFMC_LINK: async (m, sender) => {
    let ok = false
    try { const u = new URL(m.url); ok = u.protocol === 'https:' && /^mc\.s\d+\.exacttarget\.com$/i.test(u.hostname) } catch { /* not a URL */ }
    if (!ok) return { error: 'Not an SFMC link.' }
    return openSfmcLink(m.url, sender?.tab)
  },
  MCA_TOKEN_CAPTURED: (m, sender) => { handleCapturedToken(sender, m.accessToken); return null },
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type]
  if (!handler) return false
  if (!messageAllowed(message, sender, chrome.runtime.getURL(''))) {
    sendResponse({ error: 'Not allowed from this page.' })
    return false
  }
  Promise.resolve()
    .then(() => handler(message, sender))
    .then((reply) => sendResponse(reply ?? {}), (err) => sendResponse(errorReply(err)))
  return true
})
