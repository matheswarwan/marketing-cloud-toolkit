// Rows of one data extension, read straight from SFMC (feedback #117): the REST
// customobjectdata rowset by customer key, the call Run Query already uses for its
// results. No query activity and no results DE are made.
import { fetchDERows } from './sfmcApi.js'

export const ROWS_PAGE = 50
export const LOAD_ALL_PAGE = 2500
export const LOAD_ALL_LIMIT = 50000

/** Rows as plain objects, with SFMC's lower-cased names put back to the field names. */
export function rowsFrom(items, columnNames = []) {
  const proper = new Map(columnNames.map((n) => [String(n).toLowerCase(), n]))
  return (items || []).map((it) => {
    const row = {}
    for (const [k, v] of Object.entries({ ...(it.keys || {}), ...(it.values || {}) })) row[proper.get(k.toLowerCase()) ?? k] = v
    return row
  })
}

/** The column order: the DE's fields when known, then any other name seen in the rows. */
export function columnsFor(fieldNames, rows) {
  const out = [...fieldNames]
  const seen = new Set(out.map((n) => n.toLowerCase()))
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k) }
  return out
}

/**
 * Up to `pageSize` rows starting at row `offset` (0-based). SFMC pages are numbered
 * by page size, so an offset that is not on a page boundary skips into the page.
 * Returns { rows, total, last } (`last`: SFMC had no more rows after these).
 */
export async function fetchRowsAt(stack, key, offset, pageSize, columnNames = [], fetchPage = fetchDERows) {
  const page = Math.floor(offset / pageSize) + 1
  const skip = offset % pageSize
  const d = await fetchPage(stack, key, page, pageSize)
  const items = d?.items || []
  const rows = rowsFrom(items, columnNames).slice(skip)
  const total = Number.isFinite(Number(d?.count)) ? Number(d.count) : null
  return { rows, total, last: items.length < pageSize }
}

/**
 * Loads the rest of the rows (after `have`) in pages of LOAD_ALL_PAGE, up to `limit`
 * in all. `onRows(rows, total)` gets each page; `shouldStop()` ends the loop between
 * pages. Returns the number of rows added.
 */
export async function loadRemainingRows({ stack, key, have, columnNames = [], limit = LOAD_ALL_LIMIT, onRows, shouldStop = () => false, fetchPage = fetchDERows }) {
  let offset = have
  let added = 0
  while (offset < limit && !shouldStop()) {
    const { rows, total, last } = await fetchRowsAt(stack, key, offset, LOAD_ALL_PAGE, columnNames, fetchPage)
    const take = rows.slice(0, limit - offset)
    if (take.length) onRows(take, total)
    offset += take.length
    added += take.length
    if (last || !take.length || (total != null && offset >= total)) break
  }
  return added
}

/** Rows whose text in any of `columns` contains `text` (case-insensitive). */
export function filterRows(rows, columns, text) {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return rows
  return rows.filter((r) => columns.some((c) => r[c] != null && String(r[c]).toLowerCase().includes(t)))
}

/**
 * Refresh (feedback #139): reads the rows again from the start, as many as were loaded
 * (at least one page), so the viewer can swap them in without losing its filters,
 * sort and hidden columns. Returns { rows, total, done }.
 */
export async function reloadRows({ stack, key, want, columnNames = [], fetchPage = fetchDERows }) {
  const first = await fetchRowsAt(stack, key, 0, ROWS_PAGE, columnNames, fetchPage)
  let rows = first.rows
  let total = first.total
  let last = first.last
  if (!last && want > rows.length) {
    await loadRemainingRows({
      stack, key, have: rows.length, columnNames, limit: Math.min(want, LOAD_ALL_LIMIT), fetchPage,
      onRows: (page, t) => { rows = rows.concat(page); if (t != null) total = t },
    })
    if (total != null && rows.length >= total) last = true
  }
  return { rows, total, done: !!last }
}
