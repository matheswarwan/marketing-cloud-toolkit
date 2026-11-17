// Automation Studio calls (from SFMC Automation Viewer), through the service worker.
import { sfmcFetch } from './sfmcApi.js'
import { changesSince } from './localCache.js'
import { activityEndpoint } from './activityTypes.js'
import { RESULTS_PAGE_SIZE } from './paging.js'
import { legacyPageParams, legacyRows } from './automationPaging.js'

export const AUTOMATION_PAGE_SIZE = RESULTS_PAGE_SIZE
const AS = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`

export async function searchAutomations(stack, query, skip = 0, top = AUTOMATION_PAGE_SIZE, categoryId = null) {
  const name = query.trim()
  // One folder (feedback #1064): `categoryId eq <id>` in the same $where (not checked
  // live); the page also drops rows from other folders.
  const parts = [name ? `name like ${name}` : '', categoryId != null ? `categoryId eq ${Number(categoryId)}` : ''].filter(Boolean)
  const where = parts.length ? `&$where=${encodeURIComponent(parts.join(' and '))}` : ''
  // `skip` counts rows; the list wants a page number (feedback #1100, automationPaging.js).
  return legacyRows(skip, top, async (page) => {
    const data = await sfmcFetch(`${AS(stack)}/legacy/v1/beta/automations/automation/definition/?${page}&$sort=${encodeURIComponent('lastRunTime desc')}&view=gridView${where}`, 'GET')
    const entries = data?.entry || []
    return { entries, total: data?.totalResults ?? entries.length }
  })
}

/**
 * Automations in one folder (feedback #1064, #1071). SFMC's list ignored
 * `$where=categoryId eq <id>` on a live account (278 automations for one folder) and
 * its rows carry no folder field, so several forms are tried and the first that really
 * narrows the list (fewer than the unfiltered total, or rows that name the folder) is
 * remembered per stack. Returns { entries, total, form } or { unsupported: true }.
 */
const FOLDER_FORMS = ['where', 'param', 'rest']
const folderFormKey = (stack) => `toolkit_automationFolderForm_${stack}`
const folderOf = (a) => a?.categoryId ?? a?.categoryID ?? a?.category?.id ?? a?.folderId ?? a?.folder?.id ?? null

export async function searchAutomationsInFolder(stack, query, categoryId, skip = 0, top = AUTOMATION_PAGE_SIZE, fetch = sfmcFetch) {
  const cat = Number(categoryId)
  const name = query.trim()
  const nameWhere = name ? `name like ${name}` : ''
  const legacy = (where, extra = '', page = legacyPageParams(skip, top)) => `${AS(stack)}/legacy/v1/beta/automations/automation/definition/?${page}&$sort=${encodeURIComponent('lastRunTime desc')}&view=gridView${where ? `&$where=${encodeURIComponent(where)}` : ''}${extra}`
  const forms = {
    where: () => legacyRows(skip, top, async (page) => { const d = await fetch(legacy([nameWhere, `categoryId eq ${cat}`].filter(Boolean).join(' and '), '', page), 'GET'); return { entries: d?.entry || [], total: d?.totalResults ?? (d?.entry || []).length } }),
    param: () => legacyRows(skip, top, async (page) => { const d = await fetch(legacy(nameWhere, `&categoryId=${cat}`, page), 'GET'); return { entries: d?.entry || [], total: d?.totalResults ?? (d?.entry || []).length } }),
    rest: async () => {
      const page = Math.floor(skip / top) + 1
      const d = await fetch(`${AS(stack)}/automation/v1/automations?$page=${page}&$pagesize=${top}&$filter=${encodeURIComponent(`categoryId eq ${cat}`)}`, 'GET')
      const items = (d?.items || d?.entry || []).filter((i) => !name || String(i.name || '').toLowerCase().includes(name.toLowerCase()))
      return { entries: items.map((i) => ({ ...i, status: i.status ?? i.statusId })), total: d?.count ?? items.length }
    },
  }
  let remembered = null
  try { remembered = localStorage.getItem(folderFormKey(stack)) } catch { /* no storage */ }
  if (remembered && forms[remembered]) {
    try {
      const r = await forms[remembered]()
      if (r.entries.length && r.entries.every((e) => folderOf(e) != null)) {
        const mine = r.entries.filter((e) => Number(folderOf(e)) === cat)
        if (mine.length < r.entries.length) return { entries: mine, total: mine.length, form: remembered, filteredHere: true }
      }
      return { ...r, form: remembered }
    } catch { /* try them all again */ }
  }
  const all = await fetch(legacy(nameWhere, '', legacyPageParams(0, 1)), 'GET').catch(() => null)
  const allTotal = all?.totalResults ?? null
  for (const f of FOLDER_FORMS) {
    let r
    try { r = await forms[f]() } catch { continue }
    const narrowed = allTotal != null && r.total < allTotal
    // Rows that carry their folder can be filtered here even when SFMC did not.
    const labelled = r.entries.length && r.entries.every((e) => folderOf(e) != null)
    if (narrowed || labelled) {
      try { localStorage.setItem(folderFormKey(stack), f) } catch { /* no storage */ }
      if (!narrowed) {
        const mine = r.entries.filter((e) => Number(folderOf(e)) === cat)
        return { entries: mine, total: mine.length, form: f, filteredHere: true }
      }
      return { ...r, form: f }
    }
  }
  return { entries: [], total: 0, unsupported: true }
}

/**
 * Automations changed after `since` for one search (feedback #1069): the same list,
 * sorted by modifiedDate newest first, read until an older one. Status and last run
 * change without a new modifiedDate, so those stay as stored until Refresh.
 */
export function automationChanges(stack, query, categoryId, since, fetch = sfmcFetch) {
  const name = query.trim()
  const parts = [name ? `name like ${name}` : '', categoryId != null ? `categoryId eq ${Number(categoryId)}` : ''].filter(Boolean)
  const where = parts.length ? `&$where=${encodeURIComponent(parts.join(' and '))}` : ''
  return changesSince(since, async (page) => {
    const data = await fetch(`${AS(stack)}/legacy/v1/beta/automations/automation/definition/?${legacyPageParams((page - 1) * AUTOMATION_PAGE_SIZE, AUTOMATION_PAGE_SIZE)}&$sort=${encodeURIComponent('modifiedDate desc')}&view=gridView${where}`, 'GET')
    return data?.entry || []
  })
}

/**
 * The next page after the automations in `have`, without repeats. When that page brings
 * nothing new (SFMC repeated the first page or returned none, feedback #28), asks for
 * everything from the start up to one page more and keeps the new ones. The total comes
 * from the answer that had rows: a page past the end says 0 (feedback #1100).
 */
export async function loadMoreAutomations(stack, query, have, categoryId = null) {
  const known = new Set(have.map((a) => a.id))
  const r = await searchAutomations(stack, query, have.length, AUTOMATION_PAGE_SIZE, categoryId)
  let entries = r.entries.filter((a) => !known.has(a.id))
  let total = r.entries.length ? r.total : 0
  if (!entries.length) {
    const all = await searchAutomations(stack, query, 0, have.length + AUTOMATION_PAGE_SIZE, categoryId)
    entries = all.entries.filter((a) => !known.has(a.id))
    if (all.entries.length) total = all.total
  }
  return { entries, total: Math.max(total, have.length + entries.length) }
}

/** The automation and its error notifications (null when those can't be read). */
export async function fetchAutomation(stack, id) {
  const [details, notifications, legacy] = await Promise.all([
    sfmcFetch(`${AS(stack)}/automation/v1/automations/${encodeURIComponent(id)}`, 'GET'),
    sfmcFetch(`${AS(stack)}/legacy/v1/beta/automations/notifications/${encodeURIComponent(id)}/`, 'GET').catch(() => null),
    fetchLegacyDefinition(stack, id),
  ])
  return { details: legacy ? { ...details, legacy } : details, notifications }
}

/**
 * What Automation Studio's Summary tab reads (user, 2026-11-10): created by, last saved
 * by, last paused by, folder path and the schedule as wall-clock time. Only by list ID;
 * null for a REST GUID or when SFMC refuses. Its step list (`processes`) is dropped:
 * the REST record's steps are used.
 */
export async function fetchLegacyDefinition(stack, id, fetch = sfmcFetch) {
  if (!id || isAutomationGuid(id)) return null
  try {
    const d = await fetch(`${AS(stack)}/legacy/v1/beta/bulk/automations/automation/definition/${encodeURIComponent(id)}/`, 'GET')
    if (!d || typeof d !== 'object') return null
    const { processes, ...rest } = d
    return rest
  } catch { return null }
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isAutomationGuid = (id) => GUID_RE.test(String(id || ''))

/**
 * The list (legacy) ID of an automation known by its REST GUID, or null. Run history,
 * notifications and health only take the list ID (feedback #1042). Found by name in the
 * grid, then picked by key or GUID when several share the name.
 */
export async function legacyAutomationId(stack, details) {
  const name = String(details?.name || '').trim()
  if (!name) return null
  const { entries } = await searchAutomations(stack, name, 0, 50)
  const same = entries.filter((e) => String(e.name || '').toLowerCase() === name.toLowerCase())
  const lc = (v) => String(v || '').toLowerCase()
  const hit = same.find((e) => details.key && lc(e.key ?? e.customerKey) === lc(details.key))
    || same.find((e) => Object.values(e).some((v) => lc(v) === lc(details.id)))
    || (same.length === 1 ? same[0] : null)
  return hit?.id && !isAutomationGuid(hit.id) ? String(hit.id) : null
}

/** Only the automation (no notifications): what the running bar polls (feedback #123). */
export async function fetchAutomationStatus(stack, id) {
  return sfmcFetch(`${AS(stack)}/automation/v1/automations/${encodeURIComponent(id)}`, 'GET')
}

/**
 * Full details of one step activity. Wait (467) and Journey (952) have no endpoint;
 * nor do types SFMC offers no API for: those return the step's own activity object.
 * Filters also get their filter definition, File Transfers their full record.
 */
export async function fetchActivityDetails(stack, activity) {
  const url = activityEndpoint(stack, activity)
  if (!url) return { ...activity, _fromStep: true }
  const details = await sfmcFetch(url, 'GET')
  if (activity.objectTypeId === 303 && details?.filterDefinitionId) {
    details.additionalStepDetails = await sfmcFetch(`${AS(stack)}/automation/v1/filterdefinitions/${details.filterDefinitionId}`, 'GET').catch(() => null)
  } else if (activity.objectTypeId === 53 && details?.id) {
    details.additionalStepDetails = await sfmcFetch(`${AS(stack)}/automation/v1/filetransfers/${details.id}`, 'GET').catch(() => null)
  }
  return details
}

// ── Activities by type ─────────────────────────────────────
export const ACTIVITY_SEARCH_TYPES = [
  { id: 'query', label: 'Query', endpoint: 'queries', objectTypeId: 300 },
  { id: 'script', label: 'Script', endpoint: 'scripts', objectTypeId: 423 },
  { id: 'import', label: 'Import', endpoint: 'imports', objectTypeId: 43 },
  { id: 'dataextract', label: 'Data Extract', endpoint: 'dataextracts', objectTypeId: 73 },
  { id: 'filetransfer', label: 'File Transfer', endpoint: 'filetransfers', objectTypeId: 53 },
  { id: 'filter', label: 'Filter', endpoint: 'filters', objectTypeId: 303 },
]

// Endpoints that refuse $orderBy=modifiedDate (filters: "Order field is invalid, the
// following field is not allowed: 'modifiedDate'", feedback #29, and again on s4 in
// #67's report). Those are listed in SFMC's own order, and each page is sorted here.
// Filters are never asked to sort, so the failing request is not sent in every tab;
// other endpoints are remembered once they refuse.
const NEVER_SORTED = new Set(['filters'])
const unsortable = new Set()
const isOrderError = (e) => /order field is invalid/i.test(e?.message || '')
const byModifiedDesc = (a, b) => String(b.modifiedDate || '').localeCompare(String(a.modifiedDate || ''))

/** One page of activities, newest first. `unsorted` is true when SFMC could not sort the list. */
export async function searchActivities(stack, endpoint, query, page = 1, pageSize = RESULTS_PAGE_SIZE) {
  const name = query.trim()
  const filter = name ? `&$filter=${encodeURIComponent(`name like "${name}"`)}` : ''
  const url = (orderBy) => `${AS(stack)}/automation/v1/${endpoint}/?$page=${page}&$pageSize=${pageSize}${orderBy ? `&$orderBy=${encodeURIComponent('modifiedDate desc')}` : ''}&retrievalType=1${filter}`
  const key = `${stack}:${endpoint}`
  if (NEVER_SORTED.has(endpoint)) unsortable.add(key)
  let data
  if (!unsortable.has(key)) {
    try {
      data = await sfmcFetch(url(true), 'GET')
    } catch (e) {
      if (!isOrderError(e)) throw e
      unsortable.add(key)
    }
  }
  const unsorted = unsortable.has(key)
  if (unsorted) data = await sfmcFetch(url(false), 'GET')
  const items = data?.items || []
  if (unsorted) items.sort(byModifiedDesc)
  return { items, total: data?.count ?? data?.totalCount ?? items.length, unsorted }
}

/** Every activity of a type, 50 per request, at most 40 requests (2,000). */
export async function fetchAllActivities(stack, endpoint, onPage) {
  let all = []
  let total = 0
  for (let page = 1; page <= 40; page++) {
    const r = await searchActivities(stack, endpoint, '', page, 50)
    total = r.total
    all = all.concat(r.items)
    onPage?.(all.length, total)
    if (!r.items.length || all.length >= total) break
  }
  return { items: all, total, capped: all.length < total }
}

// ── Run history (feedback #41) ─────────────────────────────
// The requests Automation Studio's run log makes (from the user's HAR, 2026-10-20).
// The response bodies were not in the HAR, so runs are read by the likely field
// names and each run keeps its raw record.
const ymd = (d) => d.toISOString().slice(0, 10)
const pick = (o, names) => {
  for (const n of names) {
    const k = Object.keys(o || {}).find((x) => x.toLowerCase() === n.toLowerCase())
    if (k && o[k] != null && o[k] !== '') return o[k]
  }
  return null
}

const WORKER_NAMES = { ImportDefinition: 'Import', QueryDefinition: 'SQL Query', DataExtractDefinition: 'Data Extract', FileTransferDefinition: 'File Transfer', SsjsActivity: 'Script', EmailSendDefinition: 'Send Email', FilterDefinition: 'Filter', WaitActivity: 'Wait' }

/**
 * Failed steps of a run, from its processes (feedback #157): [{ step, activity,
 * message, workerUrl }]. SFMC's run record often says only "Error has occurred";
 * the worker instance (fetchWorkerInstance) may say more.
 */
export function runErrors(r) {
  const out = []
  for (const p of r?.processes || []) {
    for (const w of p.workerCounts || []) {
      const failed = /error|fail/i.test(String(w.status || '')) || w.error
      if (!failed) continue
      const e = w.error || {}
      out.push({
        step: p.sequence ?? null,
        activity: WORKER_NAMES[w.name] || w.name || 'Activity',
        message: e.translatedMsg || e.message || e.errorMessage || (typeof w.error === 'string' ? w.error : '') || String(w.status || 'Error'),
        workerUrl: (p.workers || [])[0] || null,
      })
    }
  }
  return out
}

export function normalizeRun(r) {
  const start = pick(r, ['startTime', 'start', 'startedTime', 'startDate'])
  const end = pick(r, ['endTime', 'completedTime', 'end', 'endDate'])
  const ms = start && end ? Date.parse(end) - Date.parse(start) : null
  return {
    id: pick(r, ['id', 'instanceId', 'automationInstanceId']),
    start,
    end,
    durationMs: Number.isFinite(ms) && ms >= 0 ? ms : null,
    status: pick(r, ['status', 'statusName', 'runStatus', 'state']),
    message: pick(r, ['statusMessage', 'message', 'errorMessage', 'details'])
      || runErrors(r).map((e) => `${e.step != null ? `Step ${e.step}, ` : ''}${e.activity}: ${e.message}`).join('; '),
    errors: runErrors(r),
    raw: r,
  }
}

/** Runs of one automation between `days` ago and today, newest first. `id` is the legacy (list) ID. */
export async function fetchRunHistory(stack, id, { days = 30, top = 50, now = new Date(), end = now } = {}) {
  const begin = new Date(now.getTime() - days * 86400000)
  const url = `${AS(stack)}/legacy/v1/beta/automations/automation/instance/?definition_id=${encodeURIComponent(id)}&$top=${top}`
    + `&begin_date=${ymd(begin)}&end_date=${ymd(end)}&order_by=${encodeURIComponent('StartTime desc')}&to_server_time=1`
  const data = await sfmcFetch(url, 'GET')
  const list = data?.entry ?? data?.items ?? (Array.isArray(data) ? data : [])
  return { runs: list.map(normalizeRun), total: data?.totalResults ?? data?.count ?? list.length }
}

/** The latest run's raw record (or null), for the running bar's step (feedback #123). */
export async function fetchLatestRun(stack, id, now = new Date()) {
  const { runs } = await fetchRunHistory(stack, id, { days: 1, top: 1, now })
  return runs[0]?.raw || null
}

/**
 * A failed step's worker instance (its URL from the run record, on the tenant's REST
 * host), read through Automation Studio's own host, where the extension has a session.
 * Returns { message, raw }. The fields are not known; likely names are read.
 */
export async function fetchWorkerInstance(stack, workerUrl) {
  const m = String(workerUrl || '').match(/\/legacy\/v1\/beta\/automations\/worker\/instance\/([^/?#]+)/)
  if (!m) throw new Error('No worker instance in the run record.')
  const raw = await sfmcFetch(`${AS(stack)}/legacy/v1/beta/automations/worker/instance/${m[1]}`, 'GET')
  const texts = []
  const look = (v, depth = 0) => {
    if (!v || depth > 4) return
    if (Array.isArray(v)) return v.forEach((x) => look(x, depth + 1))
    if (typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && /message|error|reason|description|status/i.test(k) && x.trim() && !/^(error|complete|completed)$/i.test(x.trim())) texts.push(x.trim())
      else if (x && typeof x === 'object') look(x, depth + 1)
    }
  }
  look(raw)
  return { message: [...new Set(texts)].join(' | '), raw }
}

/** Automation Studio's health summary for one automation (shape not known; shown as is). */
export async function fetchAutomationHealth(stack, id) {
  return sfmcFetch(`${AS(stack)}/legacy/v1/beta/automations/automation/definition/health/${encodeURIComponent(id)}/`, 'GET')
}
