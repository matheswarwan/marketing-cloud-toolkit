// Data Extension Finder calls (from SFMC Automation Viewer's deExplorer.js), through
// the service worker like every SFMC call. Shared and Synchronized DEs come from the
// catalog in sfmcApi.js (SFMC Query Saver's), so the two never disagree.
import { sfmcFetch, searchSharedDEs } from './sfmcApi.js'
import { RESULTS_PAGE_SIZE } from './paging.js'

export const DE_PAGE_SIZE = RESULTS_PAGE_SIZE

const CM = (stack) => `https://mc.${stack}.marketingcloudapps.com/contactsmeta/fuelapi`

// Name prefixes of DEs that SFMC and its add-ons create ("Hide system DEs").
export const SYSTEM_DE_PREFIXES = [
  'QueryStudioResults', 'log', 'ExpressionBuilderAttributes', 'IGO_PROFILES', 'IGO_VIEWS',
  'PI_SESSION_ENDS', 'IGO_PURCHASES', 'IGO_PRODUCTS', 'IGO_PRODUCTATTRIBS', 'PI_CONTENTVIEWS',
  'PI_CONTENT', 'PI_CONTENTATTRIBS', 'PI_SESSIONS', 'Einstein_MC_Predictive_Scores',
  'PI_ABANDONED_CART_EVENT', 'PI_ABANDONED_CART_ITEMS',
]
export const isSystemDE = (name) => SYSTEM_DE_PREFIXES.some((p) => String(name || '').startsWith(p))
// Query Studio's result DEs ("QueryStudioResults at ..."), hidden on their own (feedback #1004).
export const isQueryStudioResultsDE = (name) => /^QueryStudioResults/i.test(String(name || ''))

// Which DEs the Data Extensions page shows. source: 'all' | 'local' | 'shared' |
// 'sync' (local DEs have no sourceType; Shared/Synchronized ones have 'shared'/'sync').
export const DE_SOURCES = ['all', 'local', 'shared', 'sync']
export function filterDEList(list, { source = 'all', hideSystem = false, hideQueryStudio = false } = {}) {
  return list.filter((d) => {
    if (source === 'local' && d.sourceType) return false
    if ((source === 'shared' || source === 'sync') && d.sourceType !== source) return false
    if (hideSystem && isSystemDE(d.name)) return false
    if (hideQueryStudio && isQueryStudioResultsDE(d.name)) return false
    return true
  })
}

export function toDE(item, sourceType = null) {
  return {
    id: String(item.id ?? item.customerKey ?? ''),
    name: item.name || '',
    description: item.description || '',
    customerKey: item.customerKey ?? item.key ?? '',
    categoryId: item.categoryId ?? item.categoryID ?? null,
    createdDate: item.createdDate || null,
    modifiedDate: item.modifiedDate || null,
    sourceType: item.sourceType || sourceType,
    rowCount: item.rowCount ?? null,
  }
}

/**
 * What to send to SFMC's search, and how to check a name here. SFMC's search finds
 * nothing for text with spaces or dashes ("Master - Backup", feedback #22), so for
 * more than one word it gets the longest word and the whole text is matched here.
 * Brackets around the text ([Master - Backup]) are ignored.
 */
export function deSearchTerms(query) {
  const q = String(query || '').trim().replace(/^\[(.*)\]$/, '$1').trim()
  const words = q.split(/[^A-Za-z0-9_]+/).filter(Boolean)
  if (!q || (words.length === 1 && words[0] === q)) return { term: q, filter: null }
  const term = [...words].sort((a, b) => b.length - a.length)[0] || ''
  const needle = q.toLowerCase()
  return { term, filter: (name) => String(name || '').toLowerCase().includes(needle) }
}

/**
 * One page (50) of the local DEs whose name contains `query` ('' lists all), newest
 * change first. Returns { items, total, fetched, filtered }: with a filter (see
 * deSearchTerms) `items` can be fewer than `fetched`, and `total` counts SFMC's
 * matches for the single word sent.
 */
// Stacks where the `name=%text%` search was ignored (SFMC returned DEs without the
// text); those use $search, which only matches from the start of a word.
const nameSearchIgnored = new Set()

export async function searchLocalDEs(stack, query, page = 1) {
  const { term, filter } = deSearchTerms(query)
  const base = `${CM(stack)}/data-internal/v1/customobjects/category/0?retrievalType=1&$page=${page}&$pagesize=${DE_PAGE_SIZE}&$orderBy=modifiedDate%20DESC`
  const get = async (param) => {
    const data = await sfmcFetch(base + param, 'GET')
    if (!data || !Array.isArray(data.items)) throw new Error('Unexpected response from the data extension search.')
    return data
  }
  const has = (d, text) => String(d.name || '').toLowerCase().includes(text.toLowerCase())
  let data
  // `name=%text%` finds the text anywhere in the name ("120" in
  // "Loyalty_120D_Snapshot", feedback #34); $search does not.
  if (term && !nameSearchIgnored.has(stack)) {
    data = await get(`&name=${encodeURIComponent(`%${term}%`)}`)
    if (data.items.length && !data.items.some((d) => has(d, term))) {
      nameSearchIgnored.add(stack)
      data = null
    }
  }
  if (!data) data = await get(term ? `&$search=${encodeURIComponent(term)}` : '')
  const all = data.items.map((d) => toDE(d))
  return {
    items: filter ? all.filter((d) => filter(d.name)) : all,
    total: data.count ?? data.totalCount ?? data.items.length,
    fetched: all.length,
    filtered: !!filter,
  }
}

/**
 * Shared and Synchronized DEs whose name contains `query`, tagged. Slow the first
 * time for a stack (it walks their folders), then cached for 10 minutes.
 */
export async function searchSharedSyncDEs(stack, query) {
  return (await searchSharedDEs(stack, query.trim())).map((d) => toDE(d))
}

/** Both lists for one page, as SFMC Automation Viewer did (used by tests). */
export async function searchDataExtensions(stack, query, page = 1) {
  const [local, shared] = await Promise.all([
    searchLocalDEs(stack, query, page),
    page === 1 ? searchSharedSyncDEs(stack, query).catch(() => []) : Promise.resolve([]),
  ])
  const ids = new Set(shared.map((d) => d.id))
  const items = [...shared, ...local.items.filter((d) => !ids.has(d.id))]
  return { items, total: local.total + shared.length - (local.items.length - (items.length - shared.length)) }
}

const time = (d) => { const t = Date.parse(d?.modifiedDate || ''); return Number.isNaN(t) ? 0 : t }

/**
 * What the Data Extensions list can show: local DEs loaded so far (pages, newest
 * first) and Shared/Synchronized DEs (all at once), merged newest first. While more
 * local pages exist, a Shared DE older than the last local one loaded is held back
 * (a local DE not loaded yet might belong before it). Shows at most `limit`.
 */
export function mergeDEPages({ local, localDone, shared = [], limit }) {
  const sharedIds = new Set(shared.map((d) => d.id))
  const loc = local.filter((d) => !sharedIds.has(d.id))
  let ready = [...shared, ...loc].sort((a, b) => time(b) - time(a))
  if (!localDone && loc.length) {
    const cutoff = time(loc[loc.length - 1])
    ready = ready.filter((d) => time(d) >= cutoff)
  }
  return { visible: ready.slice(0, limit), hasMore: ready.length > limit || !localDone, duplicates: local.length - loc.length }
}

/** Number of rows in one DE (totalRowCount of its record; feedback #46). */
/** One DE's record (row count, description and settings). */
export function fetchDEDetail(stack, id) {
  return sfmcFetch(`${CM(stack)}/internal/v1/customobjects/${encodeURIComponent(id)}`, 'GET')
}

export async function fetchDERowCount(stack, id) {
  return deRowCountOf(await fetchDEDetail(stack, id))
}

export function deRowCountOf(d) {
  if (typeof d?.totalRowCount !== 'number') throw new Error('No row count in the response.')
  return d.totalRowCount
}

const fieldsCache = new Map() // `${stack}:${id}` → Promise<fields>

/** The fields of one DE, primary keys first, then in DE order. Cached per page. */
export function fetchDEFieldList(stack, id) {
  const key = `${stack}:${id}`
  if (!fieldsCache.has(key)) {
    const p = sfmcFetch(`${CM(stack)}/internal/v1/customobjects/${encodeURIComponent(id)}/fields`, 'GET').then((data) => {
      if (!data || !Array.isArray(data.fields)) throw new Error('No fields in the response.')
      return [...data.fields].sort((a, b) => (!!b.isPrimaryKey - !!a.isPrimaryKey) || ((a.ordinal || 0) - (b.ordinal || 0)))
    })
    p.catch(() => fieldsCache.delete(key))
    fieldsCache.set(key, p)
  }
  return fieldsCache.get(key)
}

const folderCache = new Map() // `${stack}:${id}` → Promise<{ name, parentId }>

function fetchFolder(stack, id) {
  const key = `${stack}:${id}`
  if (!folderCache.has(key)) {
    const p = sfmcFetch(`${CM(stack)}/legacy/v1/beta/folder/${id}?Localization=true&$top=1000`, 'GET')
      .then((f) => ({ name: f?.name || `Folder ${id}`, parentId: f?.parentId ?? null }))
    p.catch(() => folderCache.delete(key))
    folderCache.set(key, p)
  }
  return folderCache.get(key)
}

/** "Data Extensions > Folder > Sub folder" for a category id. */
export async function fetchDEFolderPath(stack, categoryId) {
  if (categoryId == null || categoryId === '') return ''
  const names = []
  let id = String(categoryId)
  for (let depth = 0; id && id !== '0' && depth < 30; depth++) {
    const folder = await fetchFolder(stack, id)
    names.unshift(folder.name)
    id = folder.parentId != null ? String(folder.parentId) : ''
  }
  return names.join(' > ')
}

export function clearDECaches() {
  fieldsCache.clear()
  folderCache.clear()
}

/**
 * The data extension in Contact Builder (its properties page). Not yet checked
 * against a live org. A Shared DE opens only from the business unit that owns it.
 */
export function deContactBuilderUrl(stack, de) {
  return `${CM(stack).replace('/fuelapi', '')}/admin.html#admin/data-extension/${encodeURIComponent(de.id)}/properties/`
}

/** Field type with its length and scale, e.g. "Text (254)" or "Decimal (18,2)". */
export function fieldTypeLabel(f) {
  if (!f?.type) return ''
  if (f.length && f.scale) return `${f.type} (${f.length},${f.scale})`
  if (f.length) return `${f.type} (${f.length})`
  return f.type
}
