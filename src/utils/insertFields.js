import { tokenize, significant, isWord, bracket } from './sqlTokens.js'
import { referencedTables } from './sqlContext.js'
import { bareTableName } from './schemaCatalog.js'

// "Insert all fields": writes the full column list of a DE or data view, so a
// query doesn't need SELECT * to pick up every field.

const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/
const INDENT = '    '

/** `Name`, or `[Odd Name]` when it needs brackets, optionally `q.`-qualified. */
export function fieldRef(name, qualifier) {
  const n = PLAIN.test(name) ? name : bracket(name)
  return qualifier ? `${qualifier}.${n}` : n
}

/** `Name`, `[Odd Name]`, or `ENT.[Name]` when given an ENT. name (a Shared DE, feedback #73). */
export function tableRef(name) {
  const bare = bareTableName(name)
  const ent = /^\s*ent\s*\./i.test(String(name || '')) ? 'ENT.' : ''
  return ent + (PLAIN.test(bare) ? bare : bracket(bare))
}

/** One field per line, indented like the formatter's output. */
export function columnList(fields, qualifier) {
  return fields.map(f => fieldRef(f.name, qualifier)).join(`,\n${INDENT}`)
}

// True when the `*` at sig[i] is a select-list star (SELECT *, DISTINCT *,
// TOP 10 *, TOP (10) *, `, *`), not COUNT(*) or a multiplication.
function isSelectStar(sig, i) {
  const prev = sig[i - 1]
  if (!prev) return false
  if (isWord(prev, 'SELECT', 'DISTINCT', 'ALL') || prev.type === 'comma') return true
  if (prev.type === 'number' && isWord(sig[i - 2], 'TOP')) return true
  if (prev.type === 'rparen' && sig[i - 3]?.type === 'lparen' && isWord(sig[i - 4], 'TOP')) return true
  return false
}

/**
 * Plans the edit that inserts every field of `tableName`.
 *   - empty editor: a full `SELECT … FROM table` query
 *   - `alias.*` (or `table.*`) for that table: replaced by its qualified fields
 *   - a plain `*` when that table is the only one in the query: replaced
 *   - otherwise: the list at the cursor, qualified when the query has an alias
 *     for the table or several tables
 * @returns {{ from: number, to: number, insert: string, mode: 'new'|'star'|'cursor' } | null}
 */
export function planInsertAllFields(sql, cursor, tableName, fields) {
  const text = sql || ''
  if (!fields?.length) return null
  if (!text.trim()) {
    return { from: 0, to: text.length, insert: `SELECT\n${INDENT}${columnList(fields)}\nFROM ${tableRef(tableName)}`, mode: 'new' }
  }

  const target = bareTableName(tableName).toLowerCase()
  const refs = referencedTables(text)
  const ref = refs.find(r => bareTableName(r.name).toLowerCase() === target)
  const qualifier = ref?.alias
    ? fieldRef(ref.alias)
    : (ref && refs.length > 1 ? tableRef(ref.name) : null)

  const sig = significant(tokenize(text))
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'op' || t.value !== '*') continue

    // alias.* / table.*
    if (sig[i - 1]?.type === 'dot' && ref) {
      const q = sig[i - 2]
      const qName = q?.type === 'ident' ? q.name : q?.value
      const names = [ref.alias, bareTableName(ref.name)].filter(Boolean).map(n => n.toLowerCase())
      if (qName && names.includes(qName.toLowerCase())) {
        return { from: q.start, to: t.end, insert: columnList(fields, qualifier || fieldRef(qName)), mode: 'star' }
      }
      continue
    }

    // plain * with this table as the only source
    if (isSelectStar(sig, i) && ref && refs.length === 1) {
      const prev = sig[i - 1]
      const next = sig[i + 1]
      if (prev.type === 'comma') {
        return { from: t.start, to: t.end, insert: columnList(fields, qualifier), mode: 'star' }
      }
      return {
        from: prev.end,
        to: next ? next.start : t.end,
        insert: `\n${INDENT}${columnList(fields, qualifier)}\n`,
        mode: 'star',
      }
    }
  }

  const at = Math.max(0, Math.min(cursor ?? text.length, text.length))
  return { from: at, to: at, insert: columnList(fields, qualifier), mode: 'cursor' }
}
