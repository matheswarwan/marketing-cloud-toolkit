// Reads Automation overview and Journey overview quietly after the app opens
// (feedback #78), into the page cache the two pages read first (utils/pageCache.js),
// so they show at once. Skips a page read in the last 10 minutes; never shows errors.
import { fetchCurrentBU } from './sfmcApi.js'
import { listAllAutomations, listAllJourneys } from './overview.js'
import { pageCacheKey, readPageCache, writePageCache, pendingPageCache, setPendingPageCache } from './pageCache.js'

export const PRELOAD_MAX_AGE_MS = 10 * 60 * 1000

const JOBS = [
  { page: 'automation-overview', read: listAllAutomations, patch: (list) => ({ list, trends: null }) },
  { page: 'journey-overview', read: listAllJourneys, patch: (list) => ({ list, sends: null }) },
]

/** One page after the other; resolves to the pages it read. */
export async function preloadOverviews(stack, { now = () => Date.now(), maxAgeMs = PRELOAD_MAX_AGE_MS } = {}) {
  if (!stack) return []
  const bu = await fetchCurrentBU(stack).catch(() => null)
  if (!bu) return []
  const read = []
  for (const job of JOBS) {
    const key = pageCacheKey(job.page, stack, bu.accountId)
    const saved = readPageCache(key)
    if (saved?.list && now() - saved.savedAt < maxAgeMs) continue
    if (pendingPageCache(key)) continue
    const p = setPendingPageCache(key, job.read(stack).then((list) => { writePageCache(key, job.patch(list)) }))
    try { await p; read.push(job.page) } catch { /* quiet: the page reads again when opened */ }
  }
  return read
}

// Runs once per app tab, when the browser is idle.
let started = false
export function preloadWhenIdle(stack) {
  if (started || !stack) return
  started = true
  const run = () => { preloadOverviews(stack).catch(() => undefined) }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10000 })
  else setTimeout(run, 3000)
}
