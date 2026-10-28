// Which SFMC stack is current (from SFMC Query Saver 1.3.0, "Stack resolution").
//
// Order: the user's pinned stack → the SFMC tab used most recently → any open
// logged-in SFMC tab → login cookies (one stack: use it; several: check each with a
// real API call) → the old stack probe. A stale cookie or tab from another stack
// used to win ("dropdown said s13 but I'm logged in on s10").

import { STACK_RE, stackFromPageUrl } from './apps.js'
import { storageGet, storageSet, storageRemove, queryTabs, getAllCookies } from './chromeAsync.js'

const STACK_IDS = ['s1', 's4', 's6', 's7', 's8', 's10', 's11', 's12', 's13', 's50', 's51', '401', '402', '403']
const CORE_AUTH_COOKIE_NAMES = new Set(['ETAuthCookie', 'ASP.NET_SessionId', 'platformAuthCookie'])
const STACK_FROM_CORE_HOST = /^(?:mc|members)\.([^.]+)\.exacttarget\.com$/

// SSO contexts reported by content.js, keyed by hostname and by `_stack_<stack>`.
export const sfmcSession = {}

const forgetHooks = []
// Other modules drop their per-stack caches when a stack is forgotten.
export function onForgetStack(fn) { forgetHooks.push(fn) }

// Stackless SFMC pages (mc.exacttarget.com, feedback #76) have no stack in the
// address. Their stack comes from the requests the tab makes to stack hosts (app
// frames on <app>.<stack>.marketingcloudapps.com and the like), else from the SSO
// context content.js reported for that host, else from checking each stack.
const STACKLESS_PAGE = /^https:\/\/(?:mc|members)\.exacttarget\.com\//
const STACK_IN_REQUEST = /^https:\/\/[a-z0-9-]+\.([^.]+)\.(?:exacttarget|marketingcloudapps)\.com\//
const tabStacks = {}
let tabStacksLoaded = null

function loadTabStacks() {
  if (!tabStacksLoaded) {
    tabStacksLoaded = storageGet('session', 'tabStacks')
      .then((r) => { Object.assign(tabStacks, { ...(r.tabStacks || {}), ...tabStacks }) })
      .catch(() => {})
  }
  return tabStacksLoaded
}

// webRequest.onBeforeRequest for SFMC hosts: remembers the stack each tab talks to.
export function noteRequestStack(details) {
  if (!details || details.tabId == null || details.tabId < 0) return
  const m = String(details.url || '').match(STACK_IN_REQUEST)
  if (!m || !STACK_RE.test(m[1]) || tabStacks[details.tabId] === m[1]) return
  tabStacks[details.tabId] = m[1]
  storageSet('session', { tabStacks: { ...tabStacks } })
}

export function isStacklessPage(url) {
  return STACKLESS_PAGE.test(url || '') && !url.includes('/login') && !url.includes('mc.login.')
}

// The stack of an open tab: from its address, or for a stackless page from what
// the tab requested or its SSO context.
function tabStack(tab) {
  const fromUrl = stackFromPageUrl(tab?.url)
  if (fromUrl || !isStacklessPage(tab?.url)) return fromUrl
  if (tabStacks[tab.id]) return tabStacks[tab.id]
  const ctx = sfmcSession[new URL(tab.url).hostname]
  return ctx?.stackKey && STACK_RE.test(ctx.stackKey) ? ctx.stackKey : null
}

export async function rememberActiveStack(url, tabId) {
  await loadTabStacks()
  const stack = tabStack({ url, id: tabId })
  if (stack) storageSet('session', { lastActiveStack: { stack, ts: Date.now() } })
}

export async function scanCookieStacks() {
  const now = Date.now() / 1000
  const stacks = []
  for (const c of await getAllCookies({ domain: 'exacttarget.com' })) {
    if (!CORE_AUTH_COOKIE_NAMES.has(c.name)) continue
    if (c.expirationDate && c.expirationDate <= now) continue
    const m = c.domain.replace(/^\./, '').match(STACK_FROM_CORE_HOST)
    if (m && STACK_RE.test(m[1]) && !stacks.includes(m[1])) stacks.push(m[1])
  }
  return stacks
}

async function openStackTabs() {
  await loadTabStacks()
  const list = []
  const stackless = []
  for (const t of await queryTabs({})) {
    const stack = tabStack(t)
    if (stack) list.push({ stack, lastAccessed: t.lastAccessed || 0 })
    else if (isStacklessPage(t.url)) stackless.push(t)
  }
  // A stackless tab whose stack is not known yet: the first stack with a live
  // session on its core host (the login on mc.exacttarget.com works there too).
  if (stackless.length) {
    const live = await firstLiveStack()
    if (live) {
      for (const t of stackless) {
        noteRequestStack({ tabId: t.id, url: `https://mc.${live}.exacttarget.com/` })
        list.push({ stack: live, lastAccessed: t.lastAccessed || 0 })
      }
    }
  }
  return list.sort((a, b) => b.lastAccessed - a.lastAccessed)
}

function firstLiveStack() {
  return Promise.any(STACK_IDS.map((id) => verifyStack(id).then((ok) => { if (ok) return id; throw new Error('no') })))
    .catch(() => null)
}

// A cheap authenticated GET: 200 means the cookies for this stack are a live session.
export async function verifyStack(stack) {
  try {
    const r = await fetch(
      `https://mc.${stack}.exacttarget.com/cloud/fuelapi/data-internal/v1/customobjects/category/0?retrievalType=1&$page=1&$pagesize=1`,
      { credentials: 'include', redirect: 'manual' })
    return r.status === 200
  } catch {
    return false
  }
}

// Last resort. update-token.json answers 200 only when the OAuth hop has already
// completed in this browser, so a logged-in stack can still be missed.
function probeStacks() {
  return Promise.any(
    STACK_IDS.map((id) =>
      fetch(`https://mc.${id}.marketingcloudapps.com/AutomationStudioFuel3/update-token.json`,
        { credentials: 'include', redirect: 'manual' })
        .then((r) => { if (r.status === 200) return id; throw new Error('not this stack') }))
  ).catch(() => null)
}

export async function collectStackCandidates() {
  const found = new Map()
  const add = (stack, source) => {
    if (!stack || !STACK_RE.test(stack)) return
    if (!found.has(stack)) found.set(stack, new Set())
    found.get(stack).add(source)
  }
  for (const t of await openStackTabs()) add(t.stack, 'tab')
  for (const s of await scanCookieStacks()) add(s, 'cookie')
  for (const ctx of Object.values(sfmcSession)) add(ctx?.stackKey, 'session')
  return [...found].map(([stack, sources]) => ({ stack, sources: [...sources] }))
}

export async function resolveStack() {
  const { stackOverride } = await storageGet('local', 'stackOverride')
  if (stackOverride && STACK_RE.test(stackOverride)) return { stack: stackOverride, source: 'manual' }

  const tabs = await openStackTabs()
  const { lastActiveStack } = await storageGet('session', 'lastActiveStack')
  if (lastActiveStack?.stack && tabs.some((t) => t.stack === lastActiveStack.stack)) {
    return { stack: lastActiveStack.stack, source: 'tab' }
  }
  if (tabs.length) return { stack: tabs[0].stack, source: 'tab' }

  const cookieStacks = await scanCookieStacks()
  if (cookieStacks.length === 1) return { stack: cookieStacks[0], source: 'cookie' }
  if (cookieStacks.length > 1) {
    const checks = await Promise.all(cookieStacks.map(verifyStack))
    const live = cookieStacks.find((_, i) => checks[i])
    return live ? { stack: live, source: 'cookie' } : { stack: null, source: null }
  }

  const probed = await probeStacks()
  return { stack: probed, source: probed ? 'probe' : null }
}

// Pages follow `sfmcStack` (onStackChange in utils/stackDetection.js).
export async function publishStack(stack) {
  if (!stack) return
  const { sfmcStack } = await storageGet('local', 'sfmcStack')
  if (sfmcStack !== stack) await storageSet('local', { sfmcStack: stack, sfmcStackTs: Date.now() })
}

export async function resolveAndPublish() {
  const resolved = await resolveStack()
  if (resolved.stack) await publishStack(resolved.stack)
  return resolved
}

// Drops everything cached for a stack that just failed auth, so the next lookup
// resolves afresh. A pinned stack is kept: the user chose it.
export async function forgetStack(stack) {
  if (!stack) return
  console.warn('[Toolkit:SW] Forgetting stack after an auth failure:', stack)
  for (const fn of forgetHooks) fn(stack)
  for (const [k, ctx] of Object.entries(sfmcSession)) if (ctx?.stackKey === stack) delete sfmcSession[k]
  const { sfmcStack } = await storageGet('local', 'sfmcStack')
  if (sfmcStack === stack) await storageRemove('local', ['sfmcStack', 'sfmcStackTs'])
  const { lastActiveStack } = await storageGet('session', 'lastActiveStack')
  if (lastActiveStack?.stack === stack) await storageRemove('session', 'lastActiveStack')
}

export async function getStacks() {
  const [candidates, resolved, { stackOverride }] = await Promise.all([
    collectStackCandidates(), resolveStack(), storageGet('local', 'stackOverride'),
  ])
  return { candidates, resolved: resolved.stack, source: resolved.source, override: stackOverride || null }
}

export async function setStackOverride(value) {
  const stack = value ? String(value).trim().toLowerCase() : null
  if (stack && !STACK_RE.test(stack)) return { error: 'A stack looks like s10 or 401.' }
  if (stack) await storageSet('local', { stackOverride: stack })
  else await storageRemove('local', 'stackOverride')
  const r = await resolveAndPublish()
  return { stack: r.stack, source: r.source }
}

export function captureContext(ctx) {
  if (!ctx?.hostname) return
  sfmcSession[ctx.hostname] = ctx
  if (ctx.stackKey) sfmcSession['_stack_' + ctx.stackKey] = ctx
}

export async function getSession(stackKey) {
  if (stackKey && sfmcSession['_stack_' + stackKey]) return { session: sfmcSession['_stack_' + stackKey] }
  const { stack } = await resolveAndPublish()
  if (!stack) return { session: null }
  return { session: sfmcSession['_stack_' + stack] || { stackKey: stack } }
}
