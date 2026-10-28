// Sorting and per-column filters for the shared result table (feedback #126).
// A column can give `sortValue(row)` / `filterValue(row)` for cells computed
// outside the row (folder paths, row counts), `type: 'date'` for dates and
// `sortable: false` / `filterable: false` to opt out. Sorting and filtering apply
// to the rows loaded so far.
import { formatDateTime } from './format.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}|$)/
const NUMBER = /^-?\d+(?:\.\d+)?$/

// Columns without a label (tick boxes, action links) are neither sorted nor filtered.
export const isSortable = (c) => c.sortable !== false && !!c.label
export const isFilterable = (c) => c.filterable !== false && !!c.label

function rawValue(row, c, which) {
  const fn = which === 'filter' ? c.filterValue || c.sortValue : c.sortValue
  return fn ? fn(row) : row?.[c.key]
}

/** A value to compare: a number, a time, lowercased text, or null for empty. */
export function sortKey(v, type) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  const s = String(v).trim()
  if (s === '') return null
  if (type === 'date' || ISO_DATE.test(s)) {
    const t = Date.parse(s)
    if (!Number.isNaN(t)) return t
  }
  if (type !== 'text' && NUMBER.test(s)) return Number(s)
  return s.toLowerCase()
}

function compare(a, b) {
  // Empty values go last whichever way the column is sorted (handled by the caller).
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Rows sorted by `sort` ({ key, dir: 'asc' | 'desc' }); a copy, stable. */
export function sortRows(rows, columns, sort) {
  const c = sort?.key && columns.find((col) => col.key === sort.key)
  if (!c || !sort.dir) return rows
  const sign = sort.dir === 'desc' ? -1 : 1
  return rows
    .map((row, i) => ({ row, i, k: sortKey(rawValue(row, c, 'sort'), c.type) }))
    .sort((x, y) => {
      if (x.k == null && y.k == null) return x.i - y.i
      if (x.k == null) return 1
      if (y.k == null) return -1
      return sign * compare(x.k, y.k) || x.i - y.i
    })
    .map((x) => x.row)
}

/** The text a filter matches against: the raw value, plus the date as shown. */
export function filterText(row, c) {
  const v = rawValue(row, c, 'filter')
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  const looksDate = c.type === 'date' || (typeof v === 'string' && ISO_DATE.test(v))
  return (looksDate ? `${s} ${formatDateTime(v)}` : s).toLowerCase()
}

/** Rows whose every filled-in column filter appears (case-insensitive) in that column. */
export function filterRows(rows, columns, filters) {
  const active = columns.filter((c) => (filters?.[c.key] || '').trim())
  if (!active.length) return rows
  return rows.filter((row) => active.every((c) => filterText(row, c).includes(filters[c.key].trim().toLowerCase())))
}

/** Next sort state when a header is clicked: ascending, descending, then off. */
export function nextSort(sort, key) {
  if (sort?.key !== key) return { key, dir: 'asc' }
  if (sort.dir === 'asc') return { key, dir: 'desc' }
  return null
}
