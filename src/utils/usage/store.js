// Where used data saved between tabs and sessions (feedback #26): one record per
// stack, business unit and source, in IndexedDB (the browser's site storage quota, not chrome.storage's 10 MB).
// Values are structured-cloned, so Maps and Sets survive. Where IndexedDB is missing
// (tests, a locked-down browser) it keeps the data in memory for this page only.
const DB = 'toolkit-where-used'
const STORE = 'sources'
const memory = new Map()
let dbPromise = null

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    })
  }
  return dbPromise
}

function run(mode, fn) {
  return open().then((db) => (db ? new Promise((resolve) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => resolve(undefined)
    tx.onabort = () => resolve(undefined)
  }) : undefined))
}

/** { value, savedAt } or null. */
export async function loadSaved(key) {
  if (memory.has(key)) return memory.get(key)
  const hit = await run('readonly', (s) => s.get(key)).catch(() => undefined)
  if (hit) memory.set(key, hit)
  return hit || null
}

export async function save(key, value) {
  const rec = { value, savedAt: Date.now() }
  memory.set(key, rec)
  await run('readwrite', (s) => s.put(rec, key)).catch(() => undefined)
  return rec
}

/** Forgets every saved source whose key starts with `prefix` ('' forgets all). */
export async function forget(prefix = '') {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k)
  await run('readwrite', (s) => (prefix
    ? s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))
    : s.clear())).catch(() => undefined)
}

/** Saved data in memory only (for a quick look without waiting), or null. */
export function peekSaved(key) {
  return memory.get(key) || null
}
