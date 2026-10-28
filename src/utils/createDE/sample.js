// Create DE (feedback #94): reads a small sample (pasted text or a file) into
// { columns, rows } and guesses each column's SFMC field type from its values.
// Only the start of a file is used: MAX_SAMPLE_BYTES and MAX_SAMPLE_ROWS.

export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024
export const MAX_SAMPLE_ROWS = 1000

const DELIMITERS = [',', '\t', ';', '|']

/** Which file types are read, by extension. */
export const SAMPLE_FILE_TYPES = {
  csv: 'delimited', tsv: 'delimited', tab: 'delimited', txt: 'delimited', psv: 'delimited',
  json: 'json', parquet: 'parquet', xlsx: 'spreadsheet', xls: 'spreadsheet',
}
export const SAMPLE_ACCEPT = Object.keys(SAMPLE_FILE_TYPES).map((e) => `.${e}`).join(',')

export function stripBom(text) {
  return String(text ?? '').replace(/^﻿/, '')
}

/** The delimiter that splits the first lines into the same number (2 or more) of cells. */
export function detectDelimiter(text) {
  const lines = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 10)
  if (!lines.length) return ','
  let best = ','
  let bestScore = 0
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    const first = counts[0]
    if (!first) continue
    const same = counts.filter((c) => c === first).length
    const score = same * 100 + first
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

function countOutsideQuotes(line, d) {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) n++
  }
  return n
}

/**
 * RFC 4180 style parsing: quoted cells may hold the delimiter, line breaks and
 * doubled quotes. Stops after `maxRows` rows (header included). Returns
 * { rows, truncated }.
 */
export function parseDelimited(text, delimiter = detectDelimiter(text), maxRows = MAX_SAMPLE_ROWS + 1) {
  const s = stripBom(text)
  const rows = []
  let row = []
  let cell = ''
  let q = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    cell = ''
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < s.length) {
    const ch = s[i]
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue }
        q = false
      } else cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') { q = true; i++; continue }
    if (ch === delimiter) { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      endRow()
      if (ch === '\r' && s[i + 1] === '\n') i++
      i++
      if (rows.length >= maxRows) return { rows, truncated: i < s.length && s.slice(i).trim() !== '' }
      continue
    }
    cell += ch
    i++
  }
  if (cell !== '' || row.length) endRow()
  return { rows, truncated: false }
}

/** First row as the header; the rest as data, padded or cut to the header's width. */
export function tableFromRows(rows, truncated = false) {
  if (!rows.length) return { columns: [], rows: [], truncated }
  const columns = uniqueNames(rows[0].map((h, i) => String(h ?? '').trim() || `Column${i + 1}`))
  const data = rows.slice(1, MAX_SAMPLE_ROWS + 1).map((r) => columns.map((_, i) => cellText(r[i])))
  return { columns, rows: data, truncated: truncated || rows.length - 1 > MAX_SAMPLE_ROWS }
}

function uniqueNames(names) {
  const seen = new Map()
  return names.map((n) => {
    const k = n.toLowerCase()
    const c = seen.get(k) || 0
    seen.set(k, c + 1)
    return c ? `${n}_${c + 1}` : n
  })
}

/** Any value as the text SFMC would get: dates as ISO, empty for null. */
export function cellText(v) {
  if (v == null) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().replace(/T00:00:00(\.000)?Z$/, '').replace(/\.000Z$/, 'Z')
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function parseDelimitedSample(text, delimiter) {
  const d = delimiter || detectDelimiter(text)
  const { rows, truncated } = parseDelimited(text, d)
  return { ...tableFromRows(rows, truncated), delimiter: d }
}

/** A JSON array of objects (or { rows|items|data: [...] }). */
export function parseJsonSample(text) {
  let data = JSON.parse(stripBom(text))
  if (!Array.isArray(data)) data = data?.rows || data?.items || data?.data
  if (!Array.isArray(data) || !data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    throw new Error('The JSON must be an array of objects, one per row.')
  }
  const columns = []
  for (const r of data.slice(0, MAX_SAMPLE_ROWS)) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k)
  return {
    columns,
    rows: data.slice(0, MAX_SAMPLE_ROWS).map((r) => columns.map((c) => cellText(r[c]))),
    truncated: data.length > MAX_SAMPLE_ROWS,
  }
}

/** The first rows of a Parquet file (hyparquet: plain JS, snappy or no compression). */
export async function parseParquetSample(buffer) {
  const { parquetMetadata, parquetReadObjects } = await import('hyparquet')
  const metadata = parquetMetadata(buffer)
  const total = Number(metadata.num_rows)
  const objects = await parquetReadObjects({ file: buffer, metadata, rowEnd: Math.min(total, MAX_SAMPLE_ROWS) })
  const columns = metadata.schema.slice(1).filter((e) => !e.num_children).map((e) => e.name)
  const hints = {}
  for (const e of metadata.schema.slice(1)) hints[e.name] = parquetHint(e)
  return {
    columns,
    rows: objects.map((o) => columns.map((c) => cellText(o[c]))),
    truncated: total > MAX_SAMPLE_ROWS,
    hints,
  }
}

function parquetHint(e) {
  const logical = e.logical_type?.type
  const converted = e.converted_type
  if (logical === 'DATE' || logical === 'TIMESTAMP' || converted === 'DATE' || /^TIMESTAMP/.test(converted || '')) return 'Date'
  if (e.type === 'BOOLEAN') return 'Boolean'
  if (logical === 'DECIMAL' || converted === 'DECIMAL') return 'Decimal'
  if (e.type === 'FLOAT' || e.type === 'DOUBLE') return 'Decimal'
  if (e.type === 'INT32' || e.type === 'INT64') return 'Number'
  return null
}

/** The first sheet of an Excel file (SheetJS, already in the extension for exports). */
export async function parseSpreadsheetSample(buffer) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array', sheetRows: MAX_SAMPLE_ROWS + 1, cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('The workbook has no sheets.')
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false })
  return { ...tableFromRows(rows.map((r) => r.map(cellText))), sheet: wb.SheetNames[0] }
}

function extensionOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/** Reads an uploaded file (only its first MAX_SAMPLE_BYTES for text files). */
export async function readSampleFile(file) {
  const kind = SAMPLE_FILE_TYPES[extensionOf(file.name)]
  if (!kind) throw new Error(`${file.name}: use a CSV, TSV, TXT, JSON, Parquet or Excel file.`)
  if (kind === 'parquet' || kind === 'spreadsheet') {
    if (file.size > MAX_SAMPLE_BYTES * 4) throw new Error(`${file.name} is too large for a sample (${Math.round(file.size / 1048576)} MB). Use a smaller file.`)
    const buffer = await file.arrayBuffer()
    return { kind, ...(kind === 'parquet' ? await parseParquetSample(buffer) : await parseSpreadsheetSample(buffer)) }
  }
  const part = file.size > MAX_SAMPLE_BYTES ? file.slice(0, MAX_SAMPLE_BYTES) : file
  let text = await part.text()
  const cut = file.size > MAX_SAMPLE_BYTES
  if (kind === 'json') return { kind, ...parseJsonSample(text) }
  // A cut file can end mid row: drop the last, partial line.
  if (cut) text = text.slice(0, Math.max(text.lastIndexOf('\n'), 0))
  const r = parseDelimitedSample(text, extensionOf(file.name) === 'tsv' || extensionOf(file.name) === 'tab' ? '\t' : undefined)
  return { kind, ...r, truncated: r.truncated || cut }
}

// ── Type guessing ─────────────────────────────────────────

const BOOL_VALUES = new Set(['true', 'false', 'yes', 'no', 'y', 'n'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INT = /^[-+]?(0|[1-9]\d*)$/
const DEC = /^[-+]?(\d+)\.(\d+)$|^[-+]?(\d+)$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const US_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d{2}(:\d{2})?( ?[AaPp][Mm])?)?$/
const INT32_MAX = 2147483647

export const TEXT_LENGTHS = [50, 100, 255, 500, 1000, 4000]

export function isDateText(v) {
  if (!ISO_DATE.test(v) && !US_DATE.test(v)) return false
  return !Number.isNaN(Date.parse(v.replace(' ', 'T'))) || !Number.isNaN(Date.parse(v))
}
export const isEmailText = (v) => EMAIL.test(v)
export const isBoolText = (v) => BOOL_VALUES.has(String(v).toLowerCase())
export function isIntText(v) {
  return INT.test(v) && Math.abs(Number(v)) <= INT32_MAX
}

/** A length a little above the longest sample value, from TEXT_LENGTHS. */
export function suggestTextLength(maxLen) {
  return TEXT_LENGTHS.find((l) => l >= Math.max(maxLen, 1) * 1.5) || TEXT_LENGTHS.at(-1)
}

/** Guesses one column's field: { type, length, scale, isNullable }. */
export function guessField(values, hint = null) {
  const filled = values.map((v) => String(v ?? '').trim()).filter((v) => v !== '')
  const isNullable = filled.length < values.length || !values.length
  const maxLen = filled.reduce((m, v) => Math.max(m, v.length), 0)
  const text = () => ({ type: 'Text', length: suggestTextLength(maxLen), scale: 0, isNullable })
  if (!filled.length) return hint ? { ...fixedField(hint), isNullable: true } : { type: 'Text', length: 255, scale: 0, isNullable: true }
  if (filled.every(isBoolText)) return { type: 'Boolean', length: null, scale: 0, isNullable }
  // Leading zeros (zip codes, IDs) stay Text so they are kept.
  if (filled.every(isIntText)) return { type: 'Number', length: null, scale: 0, isNullable }
  // Decimal needs at least one value with a fraction; big integers (IDs, phone
  // numbers) fall through to Text.
  if (filled.some((v) => v.includes('.')) && filled.every((v) => DEC.test(v) && !/^[-+]?0\d/.test(v))) {
    let intDigits = 1
    let scale = 0
    for (const v of filled) {
      const [i, f = ''] = v.replace(/^[-+]/, '').split('.')
      intDigits = Math.max(intDigits, i.length)
      scale = Math.max(scale, f.length)
    }
    if (intDigits + scale > 38) return text()
    return { type: 'Decimal', length: Math.min(38, Math.max(18, intDigits + scale)), scale: Math.max(scale, hint === 'Decimal' ? 2 : 0), isNullable }
  }
  if (filled.every(isDateText)) return { type: 'Date', length: null, scale: 0, isNullable }
  if (filled.every(isEmailText)) return { type: 'EmailAddress', length: null, scale: 0, isNullable }
  return text()
}

function fixedField(type) {
  if (type === 'Decimal') return { type, length: 18, scale: 2 }
  if (type === 'Text') return { type, length: 255, scale: 0 }
  return { type, length: null, scale: 0 }
}

/** Fields guessed from a sample table ({ columns, rows, hints }). */
export function fieldsFromSample(table) {
  return table.columns.map((name, i) => {
    const g = guessField(table.rows.map((r) => r[i]), table.hints?.[name])
    return { name: cleanFieldName(name), sourceName: name, ...g, isPrimaryKey: false, defaultValue: '' }
  })
}

/** A column header turned into an allowed SFMC field name. */
export function cleanFieldName(name) {
  let n = String(name ?? '').trim().replace(/[^A-Za-z0-9_ ]+/g, '_').replace(/\s*_[\s_]*/g, '_').replace(/\s+/g, ' ')
  n = n.replace(/^[_ ]+/, '').replace(/[_ ]+$/, '')
  if (!n) n = 'Field'
  if (/^\d/.test(n)) n = `F_${n}`
  return n.slice(0, 128)
}
