// Run Query clean-up (feedback #30): the data extensions and Query activities that
// Run Query (and Query Saver before it) created in SFMC. They are found and deleted
// by name: every one is called SFMCQS_<kind>_<date>_<seconds>, and nothing else is
// ever listed or deleted here.
import { searchLocalDEs } from './deApi.js'
import { searchActivities } from './automationApi.js'
import { deleteDE, deleteQueryActivity } from './sfmcApi.js'
import { runInBatches } from './batchRunner.js'

export const TOOLKIT_PREFIX = 'SFMCQS_'
const MAX_PAGES = 40 // 2,000 of each
export const isToolkitName = (name) => typeof name === 'string' && name.startsWith(TOOLKIT_PREFIX)

async function allPages(fetchPage) {
  const out = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, done } = await fetchPage(page)
    out.push(...items)
    if (done) break
  }
  return out
}

/** Data extensions named SFMCQS_..., newest first. */
export async function listToolkitDEs(stack) {
  const found = await allPages(async (page) => {
    const r = await searchLocalDEs(stack, TOOLKIT_PREFIX, page)
    return { items: r.items, done: !r.fetched || page * 50 >= r.total }
  })
  return dedupe(found.filter((d) => isToolkitName(d.name)), (d) => d.id)
}

/** Query activities named SFMCQS_..., newest first. */
export async function listToolkitQueryActivities(stack) {
  const found = await allPages(async (page) => {
    const r = await searchActivities(stack, 'queries', TOOLKIT_PREFIX, page)
    return { items: r.items, done: !r.items.length || page * 50 >= r.total }
  })
  return dedupe(found.filter((q) => isToolkitName(q.name)), (q) => q.queryDefinitionId)
    .map((q) => ({ id: q.queryDefinitionId, name: q.name, targetName: q.targetName || '', createdDate: q.createdDate || null, modifiedDate: q.modifiedDate || null }))
}

function dedupe(list, keyOf) {
  const seen = new Set()
  return list.filter((x) => { const k = keyOf(x); if (!k || seen.has(k)) return false; seen.add(k); return true })
}

/**
 * Deletes the given items, 5 at a time: Query activities first (they point at the
 * data extensions), then data extensions. Items whose name does not start with
 * SFMCQS_ are refused. Returns { deleted: [...], failed: [{ item, error }] }.
 */
export async function deleteToolkitObjects(stack, { activities = [], des = [] }, onProgress) {
  const total = activities.length + des.length
  let before = 0
  const deleted = []
  const failed = []
  const pass = async (items, kind, del) => {
    const results = await runInBatches(items, 5, async (item) => {
      if (!isToolkitName(item.name)) throw new Error(`Not created by Run Query: ${item.name}`)
      await del(item.id)
    }, { onProgress: onProgress && ((done) => onProgress(before + done, total)) })
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') deleted.push({ ...items[i], kind })
      else failed.push({ item: { ...items[i], kind }, error: r.reason?.message || String(r.reason) })
    })
    before += items.length
  }
  // Activities first, all of them, then the data extensions they wrote to.
  await pass(activities, 'activity', (id) => deleteQueryActivity(stack, id))
  await pass(des, 'de', (id) => deleteDE(stack, id))
  return { deleted, failed }
}
