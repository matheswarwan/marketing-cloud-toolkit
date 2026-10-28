// Ticked rows in a results table (feedback #138): Shift-click ranges and the
// tab-separated text Copy puts on the clipboard (pastes into Excel or Sheets).

/** The ticked set after clicking row `i` of `rows`; with `from` >= 0, the range takes the clicked row's new state. */
export function rangeSelect(picked, rows, i, from = -1) {
  const next = new Set(picked)
  const row = rows[i]
  if (row === undefined) return next
  const on = !next.has(row)
  const [a, b] = from >= 0 && from < rows.length ? [Math.min(from, i), Math.max(from, i)] : [i, i]
  for (let k = a; k <= b; k++) on ? next.add(rows[k]) : next.delete(rows[k])
  return next
}

const cell = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '))

/** Header plus rows, tab-separated, one line each. */
export function rowsAsTsv(columns, rows) {
  return [columns.map(cell).join('\t'), ...rows.map((r) => columns.map((c) => cell(r[c])).join('\t'))].join('\n')
}
