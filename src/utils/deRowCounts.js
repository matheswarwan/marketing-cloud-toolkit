// Row counts next to data extension names wherever the app shows one (feedback #72):
// activity cards (query targets, extract results, import targets), Journey Entry,
// journey entry steps and Where used. At most 10 requests run at a time, and each
// count is kept for 10 minutes. A DE known only by name is looked up by its exact
// name in the current business unit (then Shared and Synchronized); anything that
// fails gives null, and the caller shows nothing.
import { fetchDERowCount } from './deApi.js'
import { fetchDEMetadata, fetchCurrentBU } from './sfmcApi.js'
import { bareTableName } from './schemaCatalog.js'

const TTL = 10 * 60 * 1000
const MAX_RUNNING = 10

const cache = new Map() // key → { ts, promise }
const queue = []
let running = 0

function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const { fn, resolve, reject } = queue.shift()
    running++
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; pump() })
  }
}

/** Runs `fn` when fewer than 10 calls are running. */
export function limited(fn) {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump() })
}

function cached(key, fn, now) {
  const hit = cache.get(key)
  if (hit && now - hit.ts < TTL) return hit.promise
  const promise = fn()
  cache.set(key, { ts: now, promise })
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key) })
  return promise
}

/**
 * Row count of a DE given as { id?, name? }: a number, or null when it cannot be read.
 * @param {string} stack
 * @param {{ id?: string|number, name?: string }} de
 */
export async function rowCountFor(stack, de, { now = Date.now() } = {}) {
  if (!stack || !de) return null
  try {
    let id = de.id != null && de.id !== '' ? String(de.id) : null
    if (!id) {
      const name = bareTableName(de.name)
      if (!name) return null
      const bu = await fetchCurrentBU(stack).catch(() => null)
      id = await cached(`id:${stack}:${bu?.accountId ?? ''}:${name.toLowerCase()}`, () => limited(async () => {
        const m = await fetchDEMetadata(stack, name)
        // fetchDEMetadata falls back to the first partial match; only an exact name counts here.
        return m && String(m.name || '').toLowerCase() === name.toLowerCase() ? String(m.id) : null
      }), now)
      if (!id) return null
    }
    const n = await cached(`n:${stack}:${id}`, () => limited(() => fetchDERowCount(stack, id)), now)
    return typeof n === 'number' ? n : null
  } catch {
    return null
  }
}

export function clearRowCounts() {
  cache.clear()
}
