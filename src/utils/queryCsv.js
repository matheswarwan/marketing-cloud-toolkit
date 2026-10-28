// CSV export and import of saved queries (SFMC Query Saver's format: Time Saved,
// Name, Query Text).

const HEADERS = ['Time Saved', 'Name', 'Query Text']

export function csvQuote(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'
}

export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2 }
      else if (ch === '"') { inQuotes = false; i++ }
      else { field += ch; i++ }
    } else if (ch === '"') { inQuotes = true; i++ }
    else if (ch === ',') { row.push(field); field = ''; i++ }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2 }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++ }
    else { field += ch; i++ }
  }
  if (row.length > 0 || field) { row.push(field); rows.push(row) }
  return rows
}

// Only saved queries are exported (Query Saver also wrote a row for every email and
// setting in storage).
export function queriesToCsv(records) {
  const rows = records
    .filter((r) => r && typeof r.queryText === 'string')
    .sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0))
    .map((r) => [new Date(r.timeStamp).toLocaleString(), r.name || '', r.queryText].map(csvQuote).join(','))
  return [HEADERS.map(csvQuote).join(','), ...rows].join('\n')
}

// Storage entries ({ sql_<ts>_<i>: record }) for the data rows of an imported CSV.
export function csvToQueryRecords(text, now = Date.now()) {
  const entries = {}
  parseCSV(text).slice(1).forEach((cols, i) => {
    if (cols.length < 3) return
    const sql = (cols[2] || '').trim()
    if (!sql) return
    const rawTime = (cols[0] || '').trim()
    const parsed = rawTime ? new Date(rawTime).getTime() : NaN
    const timeStamp = Number.isNaN(parsed) ? now + i : parsed
    const id = `sql_${timeStamp}_${i}`
    entries[id] = {
      id, name: (cols[1] || '').trim() || 'Imported Query', queryText: sql,
      timeStamp, isFavourite: false, url: 'https://localhost/',
    }
  })
  return entries
}

export function csvFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `sfmc_queries_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.csv`
}
