// Rows of one data extension, read straight from SFMC (feedback #117): the REST
// customobjectdata rowset by customer key, the call Run Query already uses for its
// results. No query activity and no results DE are made.
import { fetchDERows, fetchDERowsById } from './sfmcApi.js'
import { CONNECTION_CODES } from './sfmcErrors.js'

export const ROWS_PAGE = 50
export const LOAD_ALL_PAGE = 2500
export const LOAD_ALL_LIMIT = 50000

/** Rows as plain objects, with SFMC's lower-cased names put back to the field names. */
export function rowsFrom(items, columnNames = []) {
  const proper = new Map(columnNames.map((n) => [String(n).toLowerCase(), n]))
  return (items || []).map((it) => {
    const row = {}
    // Public rowset: { keys, values }. Contact Builder's internal call: a flat object.
    const flat = it && (it.keys || it.values) ? { ...(it.keys || {}), ...(it.values || {}) } : { ...(it || {}) }
    for (const [k, v] of Object.entries(flat)) row[proper.get(k.toLowerCase()) ?? k] = v
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

/**
 * The last `n` rows (feedback #1097): reads the row count, then the rows from
 * count - n to the end with the same $page / $pagesize paging as Load all (a page
 * number from the offset, rows before the offset skipped). "Last" is SFMC's rowset
 * order, which is usually the order the rows were added. Returns { rows, total, from }
 * (`from`: 0-based position of the first row returned).
 */
export async function fetchLastRows({ stack, key, n, total = null, columnNames = [], fetchPage = fetchDERows }) {
  const want = Math.max(1, Math.min(LOAD_ALL_LIMIT, Math.floor(Number(n)) || 0))
  let count = total
  if (count == null) count = (await fetchRowsAt(stack, key, 0, 1, columnNames, fetchPage)).total
  if (count == null) throw new Error('SFMC did not say how many rows the data extension has, so the last rows cannot be found.')
  const from = Math.max(0, count - want)
  let rows = []
  let seen = count
  await loadRemainingRows({
    stack, key, have: from, columnNames, limit: count, fetchPage,
    onRows: (page, t) => { rows = rows.concat(page); if (t != null) seen = t },
  })
  return { rows, total: seen, from }
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

/**
 * Page reader by ID through Contact Builder, shaped like fetchDERows (stack, key, page, size).
 * If SFMC answers with a smaller pageSize than asked, it reads several of its pages so the
 * rows match what fetchDERows would return for (page, size).
 */
export function byIdPages(deId, fetchById = fetchDERowsById) {
  let cap = null // SFMC's largest page, once it has answered with a smaller one than asked
  return async (stack, _key, page, size) => {
    if (!cap || cap >= size) {
      const d = await fetchById(stack, deId, page, size)
      const served = Number(d?.pageSize) || size
      if (served >= size) return d
      cap = served
    }
    // Read SFMC's smaller pages from row `start` until `size` rows (or the end).
    const start = (page - 1) * size
    let p = Math.floor(start / cap) + 1
    let skip = start % cap
    let items = []
    let count
    for (;;) {
      const d = await fetchById(stack, deId, p, cap)
      if (d?.count != null) count = d.count
      const got = d?.items || []
      items = items.concat(got.slice(skip))
      skip = 0
      if (items.length >= size || got.length < cap) break
      p += 1
    }
    return { count, pageSize: size, items: items.slice(0, size) }
  }
}

/**
 * The page reader for one DE (feedback #1120). Synchronized DEs read by ID through Contact
 * Builder first (the public rowset by key fails for them), the rest by key first; when the
 * first way fails with anything but a connection error and the DE's ID is known, the other
 * way is tried, and whichever worked is kept for the next pages.
 */
export function rowsReader(de, { byKey = fetchDERows, fetchById = fetchDERowsById } = {}) {
  const ways = []
  const id = de?.id || de?.objectId
  const internal = id ? byIdPages(id, fetchById) : null
  if ((de?.sourceType === 'sync' || de?.sourceType === 'synchronized') && internal) ways.push(internal, byKey)
  else { ways.push(byKey); if (internal) ways.push(internal) }
  let chosen = null
  return async (stack, key, page, size) => {
    if (chosen) return chosen(stack, key, page, size)
    let firstErr
    for (const way of ways) {
      try {
        const d = await way(stack, key, page, size)
        chosen = way
        return d
      } catch (e) {
        if (CONNECTION_CODES.has(e?.code)) throw e
        if (!firstErr) firstErr = e
      }
    }
    throw firstErr
  }
}
