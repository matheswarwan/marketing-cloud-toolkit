// What "Where used" reads from SFMC, one source per kind of thing. load() reads
// everything; refresh(saved) brings saved data up to date reading as little as it
// can (feedback #26): lists sorted newest change first are read until they reach
// what was saved, and the expensive per-item details (automation steps, journey
// definitions) are fetched again only for items that changed. Saving and the
// business unit key are in index.js and store.js.
import { sfmcFetch } from '../sfmcApi.js'
import { searchActivities, searchAutomations, loadMoreAutomations } from '../automationApi.js'
import { fetchEventDefinitions } from '../journeyApi.js'
import { fetchJourney } from '../journeys.js'
import { CLOUD_PAGE_ASSET_TYPE_IDS } from '../cloudPagesApi.js'
import { activityEndpoint } from '../activityTypes.js'
import { runInBatches } from '../batchRunner.js'
import { buildActivityIndex } from './match.js'

const AS = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`
const JB = (stack) => `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1`
const CB = (stack) => `https://content-builder.${stack}.marketingcloudapps.com/fuelapi`
const PAGE = 50
const MAX_PAGES = 40 // 2,000 of each

// Content Builder asset types by group.
export const ASSET_GROUPS = {
  email: [207, 208, 209],
  template: [4, 206, 214],
  block: [195, 196, 197, 198, 199, 200, 201, 202, 203, 210, 211, 212, 213, 215, 216, 217, 219, 220, 221, 222, 223, 224, 225, 226],
  cloudpage: CLOUD_PAGE_ASSET_TYPE_IDS,
}
export function assetGroup(asset) {
  const id = Number(asset?.assetType?.id)
  return Object.keys(ASSET_GROUPS).find((g) => ASSET_GROUPS[g].includes(id)) || 'other'
}

export class StoppedError extends Error {
  constructor() { super('Stopped.'); this.stopped = true }
}

const time = (v) => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t }

async function pagesOf(fetchPage, progress, stop, maxPages = MAX_PAGES) {
  let all = []
  let total = 0
  for (let page = 0; page < maxPages; page++) {
    if (stop()) throw new StoppedError()
    const r = await fetchPage(page)
    total = r.total
    all = all.concat(r.items)
    progress(all.length, total)
    if (!r.items.length || all.length >= total) break
  }
  return { items: all, total, capped: all.length < total }
}

/**
 * Brings a saved list (sorted newest change first) up to date: reads pages until one
 * reaches items older than the newest saved change, and merges by ID. `complete` is
 * false when the counts don't add up (something was deleted, or the list was capped),
 * and the caller then reads the whole list again.
 * @returns {{ items, total, capped, changed, complete }}
 */
export async function deltaList({ saved, fetchPage, idOf, modOf, progress, stop, maxPages = MAX_PAGES }) {
  const known = new Map(saved.items.map((i) => [String(idOf(i)), i]))
  const newest = saved.items.reduce((m, i) => Math.max(m, time(modOf(i))), 0)
  let total = saved.total
  let read = 0
  let changed = 0
  for (let page = 0; page < maxPages; page++) {
    if (stop()) throw new StoppedError()
    const r = await fetchPage(page)
    total = r.total
    read += r.items.length
    for (const it of r.items) {
      const k = String(idOf(it))
      const old = known.get(k)
      if (!old || modOf(old) !== modOf(it)) changed++
      known.set(k, old && modOf(old) === modOf(it) ? old : it)
    }
    progress(read, total, 'checking for changes')
    // An unsorted list (SFMC refused the sort) can hold newer items on any page.
    if (!r.items.length || read >= total || !newest || (!r.unsorted && r.items.some((it) => time(modOf(it)) < newest))) break
  }
  const items = [...known.values()].sort((a, b) => time(modOf(b)) - time(modOf(a)))
  return { items, total, capped: items.length < total, changed, complete: items.length === total }
}

/** Every activity of one Automation Studio type, with details fetched where the list leaves `needs` out. */
function activitySource(endpoint, label, idField, { needs, detailUrl } = {}) {
  async function fillDetails(list, { stack, progress, stop }) {
    if (!needs) return
    const missing = list.items.filter((it) => it[needs] == null)
    if (!missing.length) return
    await runInBatches(missing, 10, async (it) => {
      const url = detailUrl(stack, it)
      if (!url) return
      const d = await sfmcFetch(url, 'GET')
      for (const [k, v] of Object.entries(d || {})) if (it[k] == null) it[k] = v
    }, { shouldStop: stop, onProgress: (d, t) => progress(list.items.length, list.total, `details ${d} of ${t}`) })
    if (stop()) throw new StoppedError()
  }
  const fetchPage = (stack) => (p) => searchActivities(stack, endpoint, '', p + 1, PAGE)
  const source = {
    label,
    async load(ctx) {
      const list = await pagesOf(fetchPage(ctx.stack), ctx.progress, ctx.stop)
      await fillDetails(list, ctx)
      return list
    },
    async refresh(saved, ctx) {
      const r = await deltaList({ saved, fetchPage: fetchPage(ctx.stack), idOf: (i) => i[idField], modOf: (i) => i.modifiedDate, progress: ctx.progress, stop: ctx.stop })
      if (!r.complete) return { value: await source.load(ctx), changed: null }
      await fillDetails(r, ctx)
      return { value: { items: r.items, total: r.total, capped: r.capped }, changed: r.changed }
    },
  }
  return source
}

// Only what the index needs from an automation's steps (kept small when saved).
const slimSteps = (d) => ({ id: d.id, steps: (d.steps || []).map((st, i) => ({ step: st.step ?? i + 1, name: st.name || '', activities: (st.activities || []).map((a) => ({ activityObjectId: a.activityObjectId, objectTypeId: a.objectTypeId, name: a.name || '' })) })) })
// The grid's change marker for an automation (the field name is not documented).
const autoMod = (a) => a.modifiedDate ?? a.lastSavedDate ?? a.updatedDate ?? null

function automationValue(list, details, errors) {
  const originalIds = new Map()
  for (const d of details.values()) for (const st of d.steps) for (const a of st.activities) if (a.activityObjectId) originalIds.set(String(a.activityObjectId).toLowerCase(), a.activityObjectId)
  return {
    ...list,
    details,
    originalIds,
    errors,
    byId: new Map(list.items.map((a) => [a.id, a])),
    index: buildActivityIndex([...details.values()]),
  }
}

async function readAutomations(stack, list, reuse, { progress, stop }) {
  const todo = list.items.filter((a) => !reuse(a))
  const details = new Map()
  for (const a of list.items) { const r = reuse(a); if (r) details.set(a.id, r) }
  let errors = 0
  await runInBatches(todo, 10, async (a) => {
    const d = await sfmcFetch(`${AS(stack)}/automation/v1/automations/${encodeURIComponent(a.id)}`, 'GET').catch(() => null)
    if (d) details.set(a.id, slimSteps({ ...d, id: d.id || a.id })); else errors++
  }, { shouldStop: stop, onProgress: (d, t) => progress(d, t, todo.length < list.items.length ? `reading ${t} changed` : 'reading steps') })
  if (stop()) throw new StoppedError()
  return { details, errors, read: todo.length }
}

async function listAutomations(stack, progress, stop) {
  let items = []
  let total = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    if (stop()) throw new StoppedError()
    const r = page ? await loadMoreAutomations(stack, '', items) : await searchAutomations(stack, '', 0)
    total = r.total
    items = items.concat(r.entries)
    progress(items.length, total, 'listing')
    if (!r.entries.length || items.length >= total) break
  }
  return { items, total, capped: items.length < total }
}

const listJourneys = (stack, progress, stop) => pagesOf(async (p) => {
  const params = new URLSearchParams({ $page: String(p + 1), $pageSize: String(PAGE), $orderBy: 'ModifiedDate DESC', mostRecentVersionOnly: 'true' })
  const data = await sfmcFetch(`${JB(stack)}/interactions?${params}`, 'GET')
  const items = data?.items || []
  return { items, total: data?.count ?? items.length }
}, (d, t) => progress(d, t, 'listing'), stop)

async function readJourneys(stack, list, reuse, { progress, stop }) {
  const todo = list.items.filter((j) => !reuse(j))
  const done = new Map()
  await runInBatches(todo, 10, async (j) => {
    const d = await fetchJourney(stack, j.id, j.version).catch(() => null)
    done.set(j.id, d ? { ...j, ...d } : { ...j, _error: true })
  }, { shouldStop: stop, onProgress: (d, t) => progress(d, t, todo.length < list.items.length ? `reading ${t} changed` : 'reading activities') })
  if (stop()) throw new StoppedError()
  const items = list.items.map((j) => reuse(j) || done.get(j.id) || { ...j, _error: true })
  return { items, total: list.total, capped: list.capped, errors: items.filter((j) => j._error).length, read: todo.length }
}

const ASSET_FIELDS = ['id', 'name', 'customerKey', 'assetType', 'category', 'modifiedDate', 'content', 'superContent', 'design', 'views', 'slots', 'blocks', 'data', 'meta']
function assetPage(stack, fields, pageSize = PAGE) {
  const types = Object.values(ASSET_GROUPS).flat()
  return async (p) => {
    const data = await sfmcFetch(`${CB(stack)}/asset/v1/content/assets/query`, 'POST', {
      page: { page: p + 1, pageSize },
      query: { property: 'assetType.id', simpleOperator: 'in', values: types },
      sort: [{ property: 'modifiedDate', direction: 'DESC' }],
      fields,
    })
    const items = data?.items || []
    return { items, total: data?.count ?? items.length }
  }
}

export const SOURCES = {
  queries: activitySource('queries', 'Loading SQL Query activities', 'queryDefinitionId', {
    needs: 'queryText',
    detailUrl: (s, q) => (q.queryDefinitionId ? `${AS(s)}/automation/v1/queries/${encodeURIComponent(q.queryDefinitionId)}` : null),
  }),
  imports: activitySource('imports', 'Loading Import activities', 'importDefinitionId'),
  filters: activitySource('filters', 'Loading Filter activities', 'filterActivityId'),
  dataextracts: activitySource('dataextracts', 'Loading Data Extract activities', 'dataExtractDefinitionId'),
  filetransfers: activitySource('filetransfers', 'Loading File Transfer activities', 'id', {
    needs: 'fileTransferLocationId',
    detailUrl: (s, f) => (f.id ? `${AS(s)}/automation/v1/filetransfers/${encodeURIComponent(f.id)}` : null),
  }),
  scripts: activitySource('scripts', 'Loading Script activities', 'ssjsActivityId', {
    needs: 'script',
    detailUrl: (s, x) => (x.ssjsActivityId ? `${AS(s)}/automation/v1/scripts/${encodeURIComponent(x.ssjsActivityId)}` : null),
  }),

  automations: {
    label: 'Loading automations and their steps',
    async load({ stack, progress, stop }) {
      const list = await listAutomations(stack, progress, stop)
      const r = await readAutomations(stack, list, () => null, { progress, stop })
      return automationValue(list, r.details, r.errors)
    },
    // The list is read again (there is no "changed since"); steps are read again only
    // for automations that are new or whose change marker moved.
    async refresh(saved, { stack, progress, stop }) {
      const list = await listAutomations(stack, progress, stop)
      const old = saved.byId || new Map()
      const reuse = (a) => {
        const prev = old.get(a.id)
        const d = saved.details?.get(a.id)
        return prev && d && autoMod(a) != null && autoMod(prev) === autoMod(a) ? d : null
      }
      const r = await readAutomations(stack, list, reuse, { progress, stop })
      return { value: automationValue(list, r.details, r.errors), changed: r.read }
    },
  },

  // Send Email activities (type 42) in automations: their send definitions.
  emailsends: {
    label: 'Loading Send Email activities',
    async load({ stack, progress, stop, get }) {
      const autos = await get('automations')
      if (!autos) throw new Error('needs the automations, which could not be loaded')
      const ids = [...autos.index.entries()].filter(([, list]) => list.some((e) => e.objectTypeId === 42))
        .map(([id, list]) => ({ id: autos.originalIds?.get(id) || id, name: list[0].activityName }))
      const out = []
      await runInBatches(ids, 10, async (x) => {
        const url = activityEndpoint(stack, { objectTypeId: 42, activityObjectId: x.id })
        const d = await sfmcFetch(url, 'GET').catch(() => null)
        out.push({ activityObjectId: x.id, name: d?.name || x.name, definition: d })
      }, { shouldStop: stop, onProgress: (d, t) => progress(d, t) })
      if (stop()) throw new StoppedError()
      progress(out.length, ids.length)
      return { items: out, total: ids.length, capped: false }
    },
  },

  journeys: {
    label: 'Loading journeys and their activities',
    async load({ stack, progress, stop }) {
      const list = await listJourneys(stack, progress, stop)
      const { read, ...value } = await readJourneys(stack, list, () => null, { progress, stop })
      return value
    },
    // Definitions are read again only for journeys that are new or changed (date or version).
    async refresh(saved, { stack, progress, stop }) {
      const list = await listJourneys(stack, progress, stop)
      const old = new Map(saved.items.filter((j) => !j._error).map((j) => [j.id, j]))
      const reuse = (j) => {
        const prev = old.get(j.id)
        return prev && j.modifiedDate && prev.modifiedDate === j.modifiedDate && prev.version === j.version ? prev : null
      }
      const { read, ...value } = await readJourneys(stack, list, reuse, { progress, stop })
      return { value, changed: read }
    },
  },

  events: {
    label: 'Loading journey entry events',
    async load({ stack, progress }) {
      const r = await fetchEventDefinitions(stack)
      progress(r.items.length, r.total)
      return { items: r.items, total: r.total, capped: r.items.length < r.total }
    },
  },

  locations: {
    label: 'Loading file locations',
    async load({ stack, progress }) {
      const data = await sfmcFetch(`${AS(stack)}/automation/v1/ftplocations/`, 'GET').catch(() => null)
      const items = Array.isArray(data) ? data : data?.items || []
      progress(items.length, items.length)
      return { items, total: items.length, capped: false, unavailable: !data }
    },
  },

  assets: {
    label: 'Loading emails, templates, content blocks and CloudPages',
    async load({ stack, progress, stop }) {
      return pagesOf(assetPage(stack, ASSET_FIELDS), progress, stop, 100)
    },
    // New and changed items come first (newest change first). When the count shows
    // deletions, the IDs alone are listed (cheap) to drop what is gone.
    async refresh(saved, { stack, progress, stop }) {
      const r = await deltaList({ saved, fetchPage: assetPage(stack, ASSET_FIELDS), idOf: (a) => a.id, modOf: (a) => a.modifiedDate, progress, stop, maxPages: 100 })
      if (r.complete || r.items.length < r.total) return { value: { items: r.items, total: r.total, capped: r.capped }, changed: r.changed }
      const ids = await pagesOf(assetPage(stack, ['id'], 250), (d, t) => progress(d, t, 'checking for deleted items'), stop, 40)
      if (ids.capped) return { value: await SOURCES.assets.load({ stack, progress, stop }), changed: null }
      const live = new Set(ids.items.map((a) => String(a.id)))
      const items = r.items.filter((a) => live.has(String(a.id)))
      return { value: { items, total: ids.total, capped: items.length < ids.total }, changed: r.changed + (r.items.length - items.length) }
    },
  },
}

// ── Pickers on the Where used page ───────────────────────
/** Content Builder assets of one group whose name contains `query`, newest first (50). */
export async function searchAssets(stack, query, group) {
  const types = { property: 'assetType.id', simpleOperator: 'in', values: ASSET_GROUPS[group] }
  const q = query.trim()
  const data = await sfmcFetch(`${CB(stack)}/asset/v1/content/assets/query`, 'POST', {
    page: { page: 1, pageSize: PAGE },
    query: q ? { leftOperand: { property: 'name', simpleOperator: 'like', value: q }, logicalOperator: 'AND', rightOperand: types } : types,
    sort: [{ property: 'modifiedDate', direction: 'DESC' }],
    fields: ['id', 'name', 'customerKey', 'assetType', 'category', 'modifiedDate', 'data'],
  })
  return data?.items || []
}

/** File locations (FTP, Safehouse, cloud storage). */
export async function listFileLocations(stack) {
  const data = await sfmcFetch(`${AS(stack)}/automation/v1/ftplocations/`, 'GET')
  return Array.isArray(data) ? data : data?.items || []
}
