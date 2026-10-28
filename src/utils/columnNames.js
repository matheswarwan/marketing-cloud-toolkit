import { tokenize, significant, isWord, bracket } from './sqlTokens.js'

// SFMC rejects DE field names that begin with an underscore ("Field name cannot
// begin with an underscore", error 10000). Synchronized DEs and data views are
// full of them (`_ContactKey`, `_CustomObjectKey`), so `SELECT *` from one of
// them couldn't create its target DE.
//
// Each such output column is renamed with a `t` prefix: `_ContactKey` becomes
// `t_ContactKey`. If that name is already taken by another output column (or an
// earlier rename), `t1_ContactKey`, `t2_ContactKey`, ... are tried in turn.

/**
 * @param {string[]} names  output column names, in order
 * @returns {Map<string,string>} original name → new name, only for renamed columns
 */
export function planUnderscoreRenames(names) {
  const taken = new Set(names.map(n => n.toLowerCase()))
  const renames = new Map()
  for (const name of names) {
    if (!name.startsWith('_') || renames.has(name)) continue
    let candidate = 't' + name
    for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `t${n}${name}`
    taken.add(candidate.toLowerCase())
    renames.set(name, candidate)
  }
  return renames
}

/**
 * Wraps a query so its output columns come out under new names, without
 * touching the user's SQL:
 *
 *   SELECT q.[ContactID], q.[_ContactKey] AS [t_ContactKey]
 *   FROM (
 *   <original query>
 *   ) AS q
 *
 * A top-level ORDER BY isn't allowed inside a derived table unless the query
 * has TOP or OFFSET, so it is dropped in that case. Rows written to a DE have
 * no order anyway.
 *
 * @param {string} sql        the query, trailing semicolons already removed
 * @param {string[]} columns  all output column names, in order
 * @param {Map<string,string>} renames  from planUnderscoreRenames
 * @returns {string}
 */
export function wrapWithRenamedColumns(sql, columns, renames) {
  const inner = stripUnsupportedOrderBy(sql)
  const list = columns.map(c => {
    const to = renames.get(c)
    return to ? `q.${bracket(c)} AS ${bracket(to)}` : `q.${bracket(c)}`
  })
  return `SELECT ${list.join(', ')}\nFROM (\n${inner}\n) AS q`
}

function stripUnsupportedOrderBy(sql) {
  const toks = significant(tokenize(sql)).filter(t => t.depth === 0)
  let orderAt = -1
  let hasTop = false
  let hasOffset = false
  for (let i = 0; i < toks.length; i++) {
    if (isWord(toks[i], 'TOP')) hasTop = true
    if (isWord(toks[i], 'OFFSET')) hasOffset = true
    if (isWord(toks[i], 'ORDER') && isWord(toks[i + 1], 'BY')) orderAt = i
  }
  if (orderAt === -1 || hasTop || hasOffset) return sql
  return sql.slice(0, toks[orderAt].start).trimEnd()
}
