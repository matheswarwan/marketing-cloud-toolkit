// "Join to the query" from the schema search: adds a JOIN for a data view or DE to the
// SQL in the editor, with the ON condition from the data view join rules or a shared
// key field, after the last table of the outer query's FROM.
import { tokenize, significant, isWord } from './sqlTokens.js'
import { referencedTables } from './sqlContext.js'
import { suggestJoinConditions } from './sqlBuilder.js'
import { fieldRef, tableRef } from './insertFields.js'
import { bareTableName } from './schemaCatalog.js'

const END_OF_FROM = ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION']

/** Where the JOIN goes: before the outer query's WHERE/GROUP BY/... or at the end. */
export function joinInsertPoint(sql) {
  const toks = significant(tokenize(sql))
  const from = toks.findIndex((t) => t.depth === 0 && isWord(t, 'FROM'))
  if (from < 0) return null
  const stop = toks.findIndex((t, i) => i > from && t.depth === 0 && isWord(t, ...END_OF_FROM))
  if (stop >= 0) return toks[stop].start
  const semi = toks.findIndex((t, i) => i > from && t.type === 'semi')
  return semi >= 0 ? toks[semi].start : sql.replace(/\s+$/, '').length
}

function newAlias(name, taken) {
  const base = (bareTableName(name).replace(/[^A-Za-z]/g, '').slice(0, 2) || 't').toLowerCase()
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(base + i)) return base + i
}

/**
 * Plans the JOIN text. `fieldsOf(name)` gives a table's fields (or a promise of them).
 * Returns { at, insert, alias, matched } or { error }.
 */
export async function planJoin(sql, table, fields, fieldsOf, joinType = 'LEFT JOIN') {
  const at = joinInsertPoint(sql || '')
  if (at === null) return { error: 'Write a SELECT ... FROM first; the join goes after its tables.' }
  const refs = referencedTables(sql)
  if (refs.some((r) => bareTableName(r.name).toLowerCase() === bareTableName(table.name).toLowerCase())) {
    return { error: `${bareTableName(table.name)} is already in the query.` }
  }
  const taken = new Set(refs.map((r) => String(r.alias || '').toLowerCase()).filter(Boolean))
  const alias = newAlias(table.name, taken)
  let matched = null
  for (const r of refs) {
    const own = await Promise.resolve(fieldsOf(r.name)).catch(() => null)
    const conds = suggestJoinConditions({ name: bareTableName(r.name), fields: own || [] }, { name: bareTableName(table.name), fields })
    if (conds.length) { matched = { ref: r, conds }; break }
  }
  const head = `${joinType} ${tableRef(table.name)} AS ${alias}`
  let on = '/* set the join condition */'
  if (matched) {
    const q = matched.ref.alias || tableRef(matched.ref.name)
    on = matched.conds.map((c) => `${fieldRef(c.leftField, q)} = ${fieldRef(c.rightField, alias)}`).join('\n  AND ')
  }
  const before = sql.slice(0, at)
  const lead = /\n\s*$/.test(before) ? '' : '\n'
  return { at, insert: `${lead}${head}\n  ON ${on}\n`, alias, matched: !!matched }
}
