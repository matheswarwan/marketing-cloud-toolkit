// A column's values, as in Tableau (feedback #1012): each distinct value with its row
// count, filtering to chosen values, and only the rows whose value repeats. All of it
// works on the rows loaded so far; duplicatesSql() asks SFMC about the whole DE.
import { sqlName } from './format.js'

/** The key a cell is counted under: its text, trimmed; '' for empty. */
export function valueKey(v) {
  if (v == null) return ''
  return (typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()
}

/**
 * Distinct values of `col` in `rows`, most common first (ties by value).
 * @returns {{ rows: number, distinct: number, blanks: number, repeated: number,
 *   values: Array<{ key: string, count: number }> }}  `repeated`: values on more than one row (blanks aside)
 */
export function columnValueCounts(rows, col) {
  const counts = new Map()
  for (const r of rows) {
    const k = valueKey(r?.[col])
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const values = [...counts].map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, undefined, { numeric: true }))
  return {
    rows: rows.length,
    distinct: counts.size,
    blanks: counts.get('') || 0,
    repeated: values.filter((v) => v.key !== '' && v.count > 1).length,
    values,
  }
}

/**
 * Rows kept by the value filters: `picks` { col: [keys] } keeps rows whose value is
 * one of the keys; `dups` { col: true } keeps rows whose (non-empty) value appears on
 * more than one of `rows`. `except` leaves one column's own filters out, so its list
 * still shows every value the other filters allow.
 */
export function applyValueFilters(rows, picks = {}, dups = {}, except = null) {
  let out = rows
  for (const [col, keys] of Object.entries(picks)) {
    if (col === except || !keys?.length) continue
    const keep = new Set(keys)
    out = out.filter((r) => keep.has(valueKey(r?.[col])))
  }
  for (const [col, on] of Object.entries(dups)) {
    if (col === except || !on) continue
    const seen = new Map()
    for (const r of out) { const k = valueKey(r?.[col]); if (k) seen.set(k, (seen.get(k) || 0) + 1) }
    out = out.filter((r) => (seen.get(valueKey(r?.[col])) || 0) > 1)
  }
  return out
}

/** True when any value filter is on. */
export const valueFiltering = (picks = {}, dups = {}) =>
  Object.values(picks).some((k) => k?.length) || Object.values(dups).some(Boolean)

/** SQL listing every repeated value of `col` in the whole DE. No ORDER BY: SFMC refuses it without TOP; sort the results. */
export function duplicatesSql(deName, col, { shared = false } = {}) {
  const c = sqlName(col)
  return `SELECT ${c}, COUNT(*) AS NumberOfRows\nFROM ${shared ? 'ENT.' : ''}${sqlName(deName)}\nWHERE ${c} IS NOT NULL\nGROUP BY ${c}\nHAVING COUNT(*) > 1`
}

/** SQL that counts each distinct value of `col` in the whole DE. */
export function distinctSql(deName, col, { shared = false } = {}) {
  const c = sqlName(col)
  return `SELECT ${c}, COUNT(*) AS NumberOfRows\nFROM ${shared ? 'ENT.' : ''}${sqlName(deName)}\nGROUP BY ${c}`
}
