import { tokenize, significant, isWord, identName } from './sqlTokens.js'

// Works out what the editor should suggest at a cursor position, from tokens
// only (no parser, so it also works on half-typed SQL).

const NOT_ALIAS = new Set([
  'ON', 'WHERE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'JOIN', 'GROUP', 'ORDER',
  'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'AS', 'SELECT', 'FROM', 'APPLY', 'FOR',
  'OPTION', 'AND', 'OR', 'NOT', 'IN', 'IS', 'WHEN', 'THEN', 'ELSE', 'END', 'OFFSET', 'FETCH',
])

const CLAUSE_WORDS = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'ON', 'JOIN', 'UNION', 'EXCEPT', 'INTERSECT'])

/**
 * Tables referenced after FROM / JOIN, with their aliases.
 * @returns {{ name: string, alias: string|null, from: number, to: number }[]}
 */
export function referencedTables(sql) {
  const toks = significant(tokenize(sql))
  const out = []
  for (let i = 0; i < toks.length; i++) {
    if (!isWord(toks[i], 'FROM', 'JOIN')) continue
    let j = i + 1
    if (!toks[j] || !(toks[j].type === 'word' || toks[j].type === 'ident')) continue
    if (toks[j].type === 'word' && NOT_ALIAS.has(toks[j].upper)) continue
    const parts = [toks[j]]
    while (toks[j + 1]?.type === 'dot' && toks[j + 2] && (toks[j + 2].type === 'word' || toks[j + 2].type === 'ident')) {
      parts.push(toks[j + 2]); j += 2
    }
    // A function call after FROM/JOIN (STRING_SPLIT(...)) isn't a table.
    if (toks[j + 1]?.type === 'lparen') continue
    const name = parts.map(p => (p.type === 'ident' ? p.value : p.value)).join('.')
    let k = j + 1
    if (isWord(toks[k], 'AS')) k++
    let alias = null
    if (toks[k]?.type === 'ident' || (toks[k]?.type === 'word' && !NOT_ALIAS.has(toks[k].upper))) alias = identName(toks[k])
    out.push({ name, alias, from: parts[0].start, to: parts[parts.length - 1].end })
  }
  return out
}

/**
 * @returns {{ kind: 'table'|'member'|'column'|'value'|'none', prefix: string, from: number,
 *             qualifier?: string, field?: { qualifier: string|null, name: string } }}
 */
export function completionContext(sql, pos) {
  const all = tokenize(sql)
  const at = all.find(t => t.start < pos && pos <= t.end)

  if (at?.type === 'comment') return { kind: 'none', prefix: '', from: pos }
  if (at?.type === 'string' && !(pos === at.end && !at.unterminated)) {
    return valueContext(all, at, pos)
  }

  let current = null
  if (at && (at.type === 'word' || (at.type === 'ident' && (at.unterminated || pos < at.end)))) current = at
  const prefix = current ? sql.slice(current.start, pos).replace(/^\[/, '') : ''
  const from = current ? current.start : pos

  const before = significant(all.filter(t => t.end <= from))
  const prev = before[before.length - 1]

  if (prev?.type === 'dot') {
    const q = before[before.length - 2]
    const qualifier = identName(q)
    if (qualifier) return { kind: 'member', prefix, from, qualifier }
  }
  if (isWord(prev, 'FROM', 'JOIN')) return { kind: 'table', prefix, from }
  if (prev?.type === 'comma') {
    // A comma inside a FROM list (old-style joins) still wants a table.
    for (let i = before.length - 1; i >= 0; i--) {
      const t = before[i]
      if (t.depth < prev.depth) break
      if (t.depth === prev.depth && t.type === 'word' && CLAUSE_WORDS.has(t.upper)) {
        if (t.upper === 'FROM') return { kind: 'table', prefix, from }
        break
      }
    }
  }
  return { kind: 'column', prefix, from }
}

// Inside a string: `x.Status = 'he` or `Status IN ('active', 'he` suggests known values.
function valueContext(all, str, pos) {
  const before = significant(all.filter(t => t.end <= str.start))
  let i = before.length - 1
  // Walk back over an IN ( 'a', 'b', list.
  while (i >= 0 && (before[i].type === 'comma' || before[i].type === 'string')) i--
  if (before[i]?.type === 'lparen' && isWord(before[i - 1], 'IN')) i -= 2
  else if (before[i]?.type === 'op' && ['=', '<>', '!='].includes(before[i].value)) i -= 1
  else if (isWord(before[i], 'LIKE')) i -= 1
  else return { kind: 'none', prefix: '', from: pos }
  if (isWord(before[i], 'NOT')) i--
  const name = identName(before[i])
  if (!name) return { kind: 'none', prefix: '', from: pos }
  const qualifier = before[i - 1]?.type === 'dot' ? identName(before[i - 2]) : null
  const quoteLen = str.unicode ? 2 : 1
  return { kind: 'value', prefix: str.value.slice(quoteLen, pos - str.start), from: str.start + quoteLen, field: { qualifier, name } }
}
