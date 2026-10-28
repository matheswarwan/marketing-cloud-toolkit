// DE storage fallback (feedback #68), for when SFMC's storage calls (storageApi.js)
// fail: every DE in the business unit with its row count, largest first.
import { searchLocalDEs, searchSharedSyncDEs, fetchDERowCount, isSystemDE, DE_PAGE_SIZE } from './deApi.js'
import { runInBatches } from './batchRunner.js'
import { csvQuote } from './queryCsv.js'

export const MAX_DES = 5000

/**
 * Local DEs (50 per request, up to MAX_DES) and Shared/Synchronized ones, without
 * duplicates. onProgress(loaded, total). Returns { items, total, capped }.
 */
export async function listAllDEs(stack, { onProgress, shouldStop, max = MAX_DES } = {}) {
  const items = []
  const seen = new Set()
  const add = (d) => { if (d.id && !seen.has(d.id)) { seen.add(d.id); items.push(d) } }
  let total = 0
  for (let page = 1; items.length < max; page++) {
    if (shouldStop?.()) break
    const r = await searchLocalDEs(stack, '', page)
    total = r.total
    r.items.forEach(add)
    onProgress?.(items.length, total)
    if (r.fetched < DE_PAGE_SIZE || page * DE_PAGE_SIZE >= total) break
  }
  const capped = items.length >= max && total > items.length
  const shared = await searchSharedSyncDEs(stack, '').catch(() => [])
  shared.forEach(add)
  return { items, total: total + shared.length, capped }
}

/**
 * Row counts, 10 at a time. A DE whose list record already has a count is not read
 * again. Calls onRow(de, count | null, error) per DE. Returns the number of errors.
 */
export async function readRowCounts(stack, des, { onRow, onProgress, shouldStop } = {}) {
  let errors = 0
  await runInBatches(des, 10, async (de) => {
    if (typeof de.rowCount === 'number') { onRow?.(de, de.rowCount, null); return }
    try {
      onRow?.(de, await fetchDERowCount(stack, de.id), null)
    } catch (e) {
      errors++
      onRow?.(de, null, e.message)
    }
  }, { onProgress, shouldStop })
  return errors
}

const SOURCE = (d) => (/shared/i.test(d.sourceType || '') ? 'Shared' : /sync/i.test(d.sourceType || '') ? 'Synchronized' : 'Local')
export const sourceLabel = SOURCE

/** Rows with counts first, largest first; then the rest by name. */
export function sortBySize(rows) {
  return [...rows].sort((a, b) => ((b.rows ?? -1) - (a.rows ?? -1)) || String(a.name).localeCompare(String(b.name)))
}

/** Totals for the summary cards. */
export function summarizeStorage(rows) {
  const counted = rows.filter((r) => typeof r.rows === 'number')
  const totalRows = counted.reduce((n, r) => n + r.rows, 0)
  const bySource = new Map()
  for (const r of counted) {
    const s = SOURCE(r)
    const e = bySource.get(s) || { label: s, des: 0, rows: 0 }
    e.des++
    e.rows += r.rows
    bySource.set(s, e)
  }
  return {
    des: rows.length,
    counted: counted.length,
    totalRows,
    empty: counted.filter((r) => r.rows === 0).length,
    system: rows.filter((r) => isSystemDE(r.name)).length,
    bySource: [...bySource.values()].sort((a, b) => b.rows - a.rows),
    largest: sortBySize(counted)[0] || null,
  }
}

/** Rows and DEs per folder path (paths: categoryId → "Data Extensions > A > B"), largest first. */
export function groupByFolder(rows, paths) {
  const m = new Map()
  for (const r of rows) {
    const path = paths[r.categoryId] || (r.categoryId == null ? '(no folder)' : `Folder ${r.categoryId}`)
    const e = m.get(path) || { path, des: 0, rows: 0 }
    e.des++
    e.rows += r.rows || 0
    m.set(path, e)
  }
  return [...m.values()].sort((a, b) => b.rows - a.rows || a.path.localeCompare(b.path))
}

/** CSV of every DE listed, largest first. */
export function storageCsv(rows, paths = {}) {
  const head = ['Name', 'External key', 'Source', 'Folder', 'Rows', 'Modified', 'Created', 'ID']
  const lines = sortBySize(rows).map((r) => [
    r.name, r.customerKey, SOURCE(r), paths[r.categoryId] ?? '', r.rows ?? '', r.modifiedDate || '', r.createdDate || '', r.id,
  ].map(csvQuote).join(','))
  return [head.map(csvQuote).join(','), ...lines].join('\r\n')
}
