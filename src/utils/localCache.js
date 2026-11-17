// SFMC data kept in this browser so the Toolkit asks SFMC as little as possible
// (feedback #1069, #1066): folder trees, lists and automation details, per stack and
// business unit, for up to CACHE_DAYS. Stored in IndexedDB (usage/store.js: the
// browser's site quota, not chrome.storage's 10 MB) under keys starting `cache:`.
// Refresh on a page reads SFMC again; Settings > Storage can forget it all.
import { loadSaved, save, forget, peekSaved } from './usage/store.js'
import { fetchCurrentBU } from './sfmcApi.js'

export const CACHE_DAYS = 30
export const CACHE_MAX_AGE = CACHE_DAYS * 24 * 60 * 60 * 1000
export const CACHE_PREFIX = 'cache:'

// The business unit of a stack, asked again after SCOPE_TTL (user, 2026-11-17: after a
// unit switch in SFMC, an open app tab kept storing the new unit's data under the old
// one), or at once after forgetScope.
export const SCOPE_TTL = 60 * 1000
const scopes = new Map() // stack → { at, promise }
export function cacheScope(stack, fetchBU = fetchCurrentBU, now = Date.now()) {
  if (!stack) return Promise.resolve('none:0')
  const hit = scopes.get(stack)
  if (!hit || now - hit.at > SCOPE_TTL) {
    const promise = fetchBU(stack).then((bu) => `${stack}:${bu?.accountId ?? 0}`).catch(() => `${stack}:0`)
    scopes.set(stack, { at: now, promise })
    return promise
  }
  return hit.promise
}
export function forgetScope(stack) { if (stack) scopes.delete(stack); else scopes.clear() }

// Lists and folders read from Content Builder and Journey Builder, which stayed in the
// unit they signed in to until 2.0.25 (background/appBu.js): what was stored before may
// be another unit's, so those kinds start again under a new version.
const RESTARTED_KINDS = /^(?:list-emails|list-journeys|folders-journeys|folders-content-.*)$/
export const storedKind = (kind) => (RESTARTED_KINDS.test(kind) ? `${kind}@2` : kind)

export const cacheKey = (scope, kind, sub = '') => `${CACHE_PREFIX}${storedKind(kind)}:${scope}${sub !== '' ? `:${sub}` : ''}`

/** { value, savedAt } when stored and younger than maxAge, else null. */
export async function readCache(key, maxAge = CACHE_MAX_AGE) {
  const hit = await loadSaved(key)
  if (!hit || Date.now() - hit.savedAt > maxAge) return null
  return hit
}
export const writeCache = (key, value) => save(key, value)
export const peekCache = (key) => peekSaved(key)

/** Forgets one kind (or everything stored by this module when kind is empty). */
export function forgetCache(kind = '', scope = '') {
  return forget(kind ? `${CACHE_PREFIX}${storedKind(kind)}:${scope ? `${scope}:` : ''}` : CACHE_PREFIX)
}

/**
 * The stored value, or `fetcher()`'s (then stored). `force` reads SFMC even when stored.
 * Returns { value, savedAt, fromCache }.
 */
export async function cached(key, fetcher, { force = false, maxAge = CACHE_MAX_AGE } = {}) {
  if (!force) {
    const hit = await readCache(key, maxAge)
    if (hit) return { value: hit.value, savedAt: hit.savedAt, fromCache: true }
  }
  const value = await fetcher()
  const rec = await writeCache(key, value)
  return { value, savedAt: rec.savedAt, fromCache: false }
}

// ── Delta ────────────────────────────────────────────────
const time = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : 0 }

/** The newest modified date among items (ISO string from the item, or null). */
export function newestModified(items, modOf = (i) => i.modifiedDate) {
  let best = null
  for (const i of items || []) if (time(modOf(i)) > time(best)) best = modOf(i)
  return best
}

/**
 * Stored items with the changed ones put in (matched by id; new ones added), sorted by
 * `sortBy` when given, else in the stored order with new items first.
 */
export function mergeChanges(stored, changed, { idOf = (i) => i.id, sortBy = null } = {}) {
  const byId = new Map(changed.map((i) => [String(idOf(i)), i]))
  const kept = stored.map((i) => byId.get(String(idOf(i))) ?? i)
  const known = new Set(stored.map((i) => String(idOf(i))))
  const added = changed.filter((i) => !known.has(String(idOf(i))))
  const out = [...added, ...kept]
  return sortBy ? out.sort(sortBy) : out
}

/**
 * Items changed since `since`, from a list sorted newest change first: pages are read
 * until one holds an item older than `since` (or `maxPages`). The Where used deltaList
 * method, for one list.
 */
export async function changesSince(since, fetchPage, { modOf = (i) => i.modifiedDate, maxPages = 10 } = {}) {
  const out = []
  const limit = time(since)
  for (let page = 1; page <= maxPages; page++) {
    const items = (await fetchPage(page)) || []
    const newer = items.filter((i) => time(modOf(i)) > limit)
    out.push(...newer)
    if (!items.length || newer.length < items.length) break
  }
  return out
}

/** "today", "yesterday" or "12 days ago", for the Saved note. */
export function savedAgo(savedAt, now = Date.now()) {
  const days = Math.floor((now - savedAt) / 86400000)
  if (days <= 0) {
    const mins = Math.max(1, Math.round((now - savedAt) / 60000))
    return mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`
  }
  return days === 1 ? 'yesterday' : `${days} days ago`
}
