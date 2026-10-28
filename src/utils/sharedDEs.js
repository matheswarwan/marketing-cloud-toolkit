// Shared and Synchronized Data Extensions.
//
// The global DE search (customobjects/category/0) only covers the local
// "Data Extensions" tree, so DEs under "Shared Items" and "Synchronized Data
// Extensions" are never found by name. This catalog walks those two folder
// trees, lists the DEs in each folder and keeps the list per stack for a few
// minutes, so name lookups against it are local after the first one.
// Folder requests go out BATCH_SIZE at a time. A folder that fails is skipped.

export const SHARED_SOURCE_TYPES = {
  shared_data: 'shared',
  synchronizeddataextension: 'sync',
}

const BATCH_SIZE = 10
const TTL = 10 * 60 * 1000

async function inBatches(items, worker) {
  const results = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    results.push(...await Promise.allSettled(items.slice(i, i + BATCH_SIZE).map(worker)))
  }
  return results
}

/**
 * @param {object} api
 * @param {(stack) => Promise<{entry: object[]}>} api.listRoots    root DE folders
 * @param {(stack, id) => Promise<{entry: object[]}>} api.listChildren  child folders
 * @param {(stack, id) => Promise<object[]>} api.listDEs           every DE in one folder
 * @param {() => number} [api.now]
 */
export function createSharedDECatalog({ listRoots, listChildren, listDEs, now = () => Date.now() }) {
  const cache = new Map() // stack -> { ts, promise }

  async function load(stack) {
    const roots = ((await listRoots(stack))?.entry || [])
      .filter(f => SHARED_SOURCE_TYPES[f.type] && String(f.parentId ?? '0') === '0')
      .map(f => ({ id: String(f.id), sourceType: SHARED_SOURCE_TYPES[f.type] }))

    const folders = [...roots]
    const seen = new Set(roots.map(f => f.id))
    let level = roots
    while (level.length) {
      const settled = await inBatches(level, f => listChildren(stack, f.id))
      const next = []
      settled.forEach((r, i) => {
        if (r.status !== 'fulfilled') return
        for (const child of r.value?.entry || []) {
          const id = String(child.id)
          if (seen.has(id)) continue
          seen.add(id)
          next.push({ id, sourceType: level[i].sourceType })
        }
      })
      folders.push(...next)
      level = next
    }

    const byId = new Map()
    const settled = await inBatches(folders, f => listDEs(stack, f.id))
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return
      for (const de of r.value || []) {
        if (!byId.has(de.id)) byId.set(de.id, { ...de, sourceType: folders[i].sourceType })
      }
    })
    return [...byId.values()]
  }

  /** Every Shared and Synchronized DE on the stack, each with sourceType 'shared' or 'sync'. */
  function all(stack) {
    const hit = cache.get(stack)
    if (hit && now() - hit.ts < TTL) return hit.promise
    const promise = load(stack)
    cache.set(stack, { ts: now(), promise })
    promise.catch(() => { if (cache.get(stack)?.promise === promise) cache.delete(stack) })
    return promise
  }

  /** DEs whose name contains `name` (case-insensitive), newest first. */
  async function search(stack, name) {
    const q = String(name || '').trim().toLowerCase()
    const list = await all(stack)
    return list
      .filter(de => !q || String(de.name || '').toLowerCase().includes(q))
      .sort((a, b) => String(b.modifiedDate || '').localeCompare(String(a.modifiedDate || '')))
  }

  /** The DE named exactly `name` (case-insensitive), or null. */
  async function find(stack, name) {
    const q = String(name || '').trim().toLowerCase()
    return (await all(stack)).find(de => String(de.name || '').toLowerCase() === q) || null
  }

  function clear(stack) {
    if (stack) cache.delete(stack)
    else cache.clear()
  }

  return { all, search, find, clear }
}
