// SQL to Query Builder: reads a SELECT into the builder's model, so a query from Run
// Query or Saved queries opens as a diagram. Works on the Toolkit's tokenizer (it
// never throws and keeps exact text), so expressions it cannot model are kept as the
// user wrote them and round-trip unchanged.
//
// parseSqlForBuilder(sql) -> {
//   tables: [{ name, alias, ent, dataView, joinType, on: { conditions, combinator, raw } | null }],
//   columns: [{ alias, field, as } | { expr, as } | { star, alias }],
//   where, having (raw text), groupBy, orderBy, distinct, top, notes: [text], error }
import { tokenize, significant, isWord, identName } from './sqlTokens.js'
import { DATA_VIEWS } from './dataViews.js'
import { smartAlias } from './builderOrder.js'

const DATA_VIEW_NAMES = new Set([...DATA_VIEWS].map((v) => v.toUpperCase()))
const CLAUSES = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER']
const SET_OPS = ['UNION', 'EXCEPT', 'INTERSECT']
const JOIN_WORDS = ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER']
const COMPARE = ['=', '<>', '!=', '>', '<', '>=', '<=']

const text = (sql, toks) => (toks.length ? sql.slice(toks[0].start, toks[toks.length - 1].end).trim() : '')

/** Splits significant tokens at depth-0 tokens matching `isSep`. */
function splitAt(toks, isSep) {
  const parts = [[]]
  const seps = []
  for (const t of toks) {
    if (t.depth === 0 && isSep(t)) { seps.push(t); parts.push([]) } else parts[parts.length - 1].push(t)
  }
  return { parts, seps }
}

/** Lowers the depth of tokens inside one pair of outer parentheses, or returns null. */
function unwrapParens(toks) {
  if (toks.length < 2 || toks[0].type !== 'lparen' || toks[toks.length - 1].type !== 'rparen') return null
  // The first ( must close at the last token.
  const d = toks[0].depth
  for (let i = 1; i < toks.length - 1; i++) if (toks[i].type === 'rparen' && toks[i].depth === d) return null
  return toks.slice(1, -1).map((t) => ({ ...t, depth: t.depth - 1 }))
}

/** `alias.field`, `[alias].[field]` or `field` as one column reference, else null. */
function columnRef(toks) {
  const name = (t) => (t?.type === 'ident' || t?.type === 'word' ? identName(t) : null)
  if (toks.length === 1 && name(toks[0]) && !isWord(toks[0], 'NULL')) return { alias: '', field: name(toks[0]) }
  if (toks.length === 3 && name(toks[0]) && toks[1].type === 'dot' && name(toks[2])) return { alias: name(toks[0]), field: name(toks[2]) }
  return null
}

function literal(toks) {
  if (toks.length === 1 && (toks[0].type === 'string' || toks[0].type === 'number')) {
    const t = toks[0]
    if (t.type === 'number') return { value: t.value, raw: false }
    if (t.unicode) return { value: t.value, raw: true }
    return { value: t.value.slice(1, -1).replace(/''/g, "'"), raw: false }
  }
  if (toks.length === 2 && toks[0].type === 'op' && toks[0].value === '-' && toks[1].type === 'number') return { value: '-' + toks[1].value, raw: false }
  return null
}

/**
 * One WHERE/HAVING leaf as a builder condition: column op literal, IN list, LIKE,
 * IS [NOT] NULL; column op expression keeps the expression as a raw value; anything
 * else becomes { expr } (written out as is).
 */
function whereLeaf(sql, toks) {
  const t = toks
  const exprCond = { expr: text(sql, t) }
  // IS [NOT] NULL
  if (t.length >= 3 && isWord(t[t.length - 1], 'NULL') && isWord(t[t.length - 2], 'IS', 'NOT')) {
    const not = isWord(t[t.length - 2], 'NOT')
    const col = columnRef(t.slice(0, not ? -3 : -2))
    if (col && (!not || isWord(t[t.length - 3], 'IS'))) return { ...col, operator: not ? 'IS NOT NULL' : 'IS NULL', value: '' }
    return exprCond
  }
  // [NOT] IN (...) / [NOT] LIKE x
  for (let i = 1; i < t.length; i++) {
    if (!(isWord(t[i], 'IN', 'LIKE') && t[i].depth === 0)) continue
    const not = isWord(t[i - 1], 'NOT')
    const col = columnRef(t.slice(0, not ? i - 1 : i))
    if (!col) return exprCond
    const rest = t.slice(i + 1)
    const op = (not ? 'NOT ' : '') + t[i].upper
    if (t[i].upper === 'IN') {
      const inner = unwrapParens(rest)
      if (!inner || inner.some((x) => isWord(x, 'SELECT'))) return exprCond
      const items = splitAt(inner, (x) => x.type === 'comma').parts.map(literal)
      if (items.some((x) => !x || x.raw)) return { ...col, operator: op, value: text(sql, rest), raw: true }
      return { ...col, operator: op, value: items.map((x) => x.value).join(', ') }
    }
    const lit = literal(rest)
    return lit ? { ...col, operator: op, ...lit } : { ...col, operator: op, value: text(sql, rest), raw: true }
  }
  // col op value
  const opAt = t.findIndex((x) => x.depth === 0 && x.type === 'op' && COMPARE.includes(x.value))
  if (opAt > 0) {
    const col = columnRef(t.slice(0, opAt))
    const rest = t.slice(opAt + 1)
    if (col && rest.length) {
      const operator = t[opAt].value === '!=' ? '<>' : t[opAt].value
      const lit = literal(rest)
      return lit ? { ...col, operator, ...lit } : { ...col, operator, value: text(sql, rest), raw: true }
    }
  }
  return exprCond
}

/**
 * A boolean expression as a group: { combinator, conditions } where a condition is a
 * leaf or a nested group. Mixed AND/OR at one level follow SQL precedence (AND binds
 * tighter), so `a OR b AND c` becomes OR [a, AND [b, c]]. BETWEEN x AND y stays one leaf.
 */
export function parseCondition(sql, toks) {
  const inner = unwrapParens(toks)
  if (inner) {
    const g = parseCondition(sql, inner)
    return g.conditions.length === 1 && !g.conditions[0].conditions ? g : g
  }
  // Depth-0 AND/OR, skipping the AND of BETWEEN.
  const seps = []
  let between = false
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.depth !== 0) continue
    if (isWord(t, 'BETWEEN')) between = true
    else if (isWord(t, 'AND') && between) between = false
    else if (isWord(t, 'AND', 'OR')) seps.push(i)
  }
  if (!seps.length) return { combinator: 'AND', conditions: [leafOrGroup(sql, toks)] }
  const parts = []
  let from = 0
  const ops = []
  for (const i of seps) { parts.push(toks.slice(from, i)); ops.push(toks[i].upper); from = i + 1 }
  parts.push(toks.slice(from))
  if (ops.every((o) => o === ops[0])) return { combinator: ops[0], conditions: parts.map((p) => leafOrGroup(sql, p)) }
  // Mixed: split on OR, each part an AND group.
  const orParts = [[parts[0]]]
  ops.forEach((o, i) => { if (o === 'OR') orParts.push([parts[i + 1]]); else orParts[orParts.length - 1].push(parts[i + 1]) })
  return {
    combinator: 'OR',
    conditions: orParts.map((ps) => (ps.length === 1 ? leafOrGroup(sql, ps[0]) : { combinator: 'AND', conditions: ps.map((p) => leafOrGroup(sql, p)) })),
  }
}

function leafOrGroup(sql, toks) {
  const inner = unwrapParens(toks)
  if (inner && !inner.some((x) => x.depth === 0 && isWord(x, 'SELECT'))) {
    const g = parseCondition(sql, inner)
    return g.conditions.length === 1 ? g.conditions[0] : g
  }
  return whereLeaf(sql, toks)
}

/**
 * ON conditions of a join as builder rows ({ leftAlias, leftField, operator, rightField, conn })
 * when every leaf compares a column of this table with a column of another table;
 * otherwise null (the ON text is kept as a raw ON).
 */
function joinConditions(sql, toks, rightAlias) {
  const g = parseCondition(sql, toks)
  const rows = []
  const flat = (grp, conn) => {
    grp.conditions.forEach((c, i) => {
      if (c.conditions) {
        if (grp.conditions.length > 1) throw new Error('nested')
        return flat(c, conn)
      }
      if (c.expr || !c.raw) throw new Error('not a column pair')
      const other = columnRef(tokenizeSig(c.value))
      if (!other || !COMPARE.includes(c.operator)) throw new Error('not a column pair')
      const norm = (a) => a.toLowerCase()
      let left = { alias: c.alias, field: c.field }
      let right = other
      let operator = c.operator
      if (norm(left.alias) === norm(rightAlias) && norm(right.alias) !== norm(rightAlias)) {
        ;[left, right] = [right, left]
        operator = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }[operator] || operator
      }
      if (norm(right.alias) !== norm(rightAlias) || norm(left.alias) === norm(rightAlias)) throw new Error('not this table')
      rows.push({ leftAlias: left.alias, leftField: left.field, operator, rightField: right.field, conn: i ? (conn || grp.combinator) : 'AND' })
    })
  }
  try {
    flat(g, null)
  } catch {
    return null
  }
  // Mixed AND/OR come back as nested groups, which `flat` refuses, so the rows
  // read left to right with each row's own connector.
  return { conditions: rows, combinator: g.combinator }
}

const tokenizeSig = (s) => significant(tokenize(s))

/** Table reference tokens: [db.]name [AS] alias [WITH (NOLOCK)]. */
function tableRef(toks) {
  const t = toks.filter((x) => !(x.depth > 0 || x.type === 'lparen' || x.type === 'rparen' || isWord(x, 'WITH', 'NOLOCK')))
  if (!t.length) return null
  if (t[0].type === 'lparen' || toks[0]?.type === 'lparen') return null
  let i = 0
  let ent = false
  const parts = [identName(t[i])]
  while (t[i + 1]?.type === 'dot' && t[i + 2]) { parts.push(identName(t[i + 2])); i += 2 }
  if (parts.some((p) => p == null)) return null
  const name = parts[parts.length - 1]
  if (parts.length > 1 && String(parts[0]).toUpperCase() === 'ENT') ent = true
  i++
  if (isWord(t[i], 'AS')) i++
  const alias = t[i] && (t[i].type === 'ident' || t[i].type === 'word') ? identName(t[i]) : ''
  const dataView = DATA_VIEW_NAMES.has(String(name).toUpperCase())
  return { name, alias, ent, dataView, prefix: parts.length > 1 && !ent ? parts.slice(0, -1).join('.') : '' }
}

/** Splits FROM into table segments at depth-0 joins and commas. */
function fromSegments(sql, toks, notes) {
  const segs = []
  let cur = { joinType: null, toks: [] }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.depth === 0 && (t.type === 'comma' || isWord(t, 'JOIN', 'APPLY'))) {
      // Collect the join words just before JOIN (INNER, LEFT OUTER, CROSS...).
      let k = cur.toks.length
      while (k > 0 && cur.toks[k - 1].depth === 0 && isWord(cur.toks[k - 1], ...JOIN_WORDS)) k--
      const words = cur.toks.slice(k).map((x) => x.upper)
      cur.toks = cur.toks.slice(0, k)
      segs.push(cur)
      let joinType = 'INNER JOIN'
      if (t.type === 'comma') { joinType = ','; notes.add('Comma-separated tables in FROM (old style join) were turned into joins without a condition. SFMC refuses this syntax.') }
      else if (isWord(t, 'APPLY')) { joinType = words.includes('OUTER') ? 'OUTER APPLY' : 'CROSS APPLY' }
      else if (words.includes('LEFT')) joinType = 'LEFT JOIN'
      else if (words.includes('RIGHT')) joinType = 'RIGHT JOIN'
      else if (words.includes('FULL')) joinType = 'FULL OUTER JOIN'
      else if (words.includes('CROSS')) joinType = 'CROSS JOIN'
      cur = { joinType, toks: [] }
    } else cur.toks.push(t)
  }
  segs.push(cur)
  return segs.map((s) => {
    const onAt = s.toks.findIndex((x) => x.depth === 0 && isWord(x, 'ON'))
    const tableToks = onAt < 0 ? s.toks : s.toks.slice(0, onAt)
    const onToks = onAt < 0 ? [] : s.toks.slice(onAt + 1)
    return { joinType: s.joinType, tableToks, onToks, tableText: text(sql, tableToks), onText: text(sql, onToks) }
  })
}

/** A SELECT item: column, column AS x, expr AS x, x = expr, alias.*, *. */
function selectItem(sql, toks) {
  if (toks.length === 1 && toks[0].type === 'op' && toks[0].value === '*') return { star: true, alias: '' }
  if (toks.length === 3 && toks[1].type === 'dot' && toks[2].value === '*') return { star: true, alias: identName(toks[0]) }
  let body = toks
  let as = ''
  const last = toks[toks.length - 1]
  const prev = toks[toks.length - 2]
  if (toks.length >= 2 && isWord(prev, 'AS') && (last.type === 'ident' || last.type === 'word' || last.type === 'string')) {
    as = last.type === 'string' ? last.value.slice(1, -1) : identName(last); body = toks.slice(0, -2)
  } else if (toks.length >= 2 && (last.type === 'ident' || (last.type === 'word' && !isWord(last, 'END', 'NULL'))) &&
    (prev.type === 'rparen' || prev.type === 'ident' || prev.type === 'word' || prev.type === 'string' || prev.type === 'number') &&
    !(toks.length === 3 && prev.type !== 'rparen' && toks[1].type === 'dot')) {
    // expr alias (no AS); not alias.field
    if (!(toks.length === 3 && toks[1].type === 'dot')) { as = identName(last); body = toks.slice(0, -1) }
  } else if (toks.length >= 3 && (toks[0].type === 'ident' || toks[0].type === 'word') && toks[1].type === 'op' && toks[1].value === '=') {
    as = identName(toks[0]); body = toks.slice(2)
  }
  const col = columnRef(body)
  if (col) return { ...col, as: as && as.toLowerCase() !== col.field.toLowerCase() ? as : '' }
  return { expr: text(sql, body), as }
}

function orderItem(sql, toks) {
  let dir = 'ASC'
  let body = toks
  if (isWord(toks[toks.length - 1], 'ASC', 'DESC')) { dir = toks[toks.length - 1].upper; body = toks.slice(0, -1) }
  const col = columnRef(body)
  return col ? { ...col, dir } : { expr: text(sql, body), dir }
}

/**
 * Splits a query at its depth-0 UNION [ALL] / EXCEPT / INTERSECT:
 * { branches: [sql text], ops: ['UNION ALL', ...] } (ops.length = branches.length - 1).
 */
export function splitSetOperations(sql) {
  const toks = significant(tokenize(sql || ''))
  const branches = []
  const ops = []
  let from = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.depth !== 0 || !isWord(t, ...SET_OPS)) continue
    branches.push(sql.slice(from, t.start).trim())
    const all = isWord(toks[i + 1], 'ALL')
    ops.push(all ? `${t.upper} ALL` : t.upper)
    from = all ? toks[i + 1].end : t.end
    if (all) i++
  }
  branches.push(sql.slice(from).trim())
  return { branches, ops }
}

export function parseSqlForBuilder(sql) {
  const notes = new Set()
  const all = tokenize(sql || '')
  if (all.some((t) => t.type === 'comment')) notes.add('Comments are not kept in the builder.')
  let toks = significant(all).filter((t) => t.type !== 'semi')
  // Only the first SELECT of a UNION / EXCEPT / INTERSECT.
  const setAt = toks.findIndex((t) => t.depth === 0 && isWord(t, ...SET_OPS))
  let branches = 1
  if (setAt >= 0) {
    branches = toks.filter((t) => t.depth === 0 && isWord(t, ...SET_OPS)).length + 1
    notes.add(`${toks[setAt].upper}: only the first of ${branches} SELECT statements was drawn.`)
    toks = toks.slice(0, setAt)
  }
  if (isWord(toks[0], 'WITH')) return { error: 'The query starts with WITH (a CTE). SFMC does not run WITH; rewrite the CTE as a subquery in FROM first.' }
  if (!isWord(toks[0], 'SELECT')) return { error: 'Only a SELECT query can open in the Query Builder.' }

  // Clause boundaries at depth 0.
  const at = {}
  toks.forEach((t, i) => {
    if (t.depth !== 0 || t.type !== 'word') return
    if (CLAUSES.includes(t.upper) && at[t.upper] === undefined) {
      if ((t.upper === 'GROUP' || t.upper === 'ORDER') && !isWord(toks[i + 1], 'BY')) return
      at[t.upper] = i
    }
  })
  if (at.FROM === undefined) return { error: 'The query has no FROM, so there are no tables to draw.' }
  const order = Object.entries(at).sort((a, b) => a[1] - b[1])
  const clause = (name) => {
    const k = order.findIndex(([n]) => n === name)
    if (k < 0) return null
    const start = order[k][1] + (name === 'GROUP' || name === 'ORDER' ? 2 : 1)
    const end = k + 1 < order.length ? order[k + 1][1] : toks.length
    return toks.slice(start, end)
  }

  // SELECT [DISTINCT] [TOP n [PERCENT]] list
  let sel = clause('SELECT')
  let distinct = false
  let top = null
  if (isWord(sel[0], 'DISTINCT')) { distinct = true; sel = sel.slice(1) }
  if (isWord(sel[0], 'TOP')) {
    const n = sel[1]?.type === 'lparen' ? sel[2] : sel[1]
    top = n?.type === 'number' ? Number(n.value) : null
    let skip = sel[1]?.type === 'lparen' ? 4 : 2
    if (isWord(sel[skip], 'PERCENT')) { notes.add('TOP ... PERCENT became TOP n rows.'); skip++ }
    if (isWord(sel[skip], 'WITH') && isWord(sel[skip + 1], 'TIES')) { notes.add('WITH TIES is not kept.'); skip += 2 }
    sel = sel.slice(skip)
  }
  if (isWord(sel[0], 'DISTINCT')) { distinct = true; sel = sel.slice(1) }
  const columns = splitAt(sel, (t) => t.type === 'comma').parts.filter((p) => p.length).map((p) => selectItem(sql, p))
  if (sel.some((t) => t.depth === 0 && isWord(t, 'INTO'))) return { error: 'SELECT INTO is not supported in SFMC or the builder.' }

  // FROM
  const tables = []
  for (const seg of fromSegments(sql, clause('FROM'), notes)) {
    if (seg.tableToks[0]?.type === 'lparen') {
      // A subquery in FROM: one card named by its alias, with the subquery's output columns.
      const open = seg.tableToks[0]
      const close = seg.tableToks.find((x, k) => k > 0 && x.type === 'rparen' && x.depth === open.depth)
      const after = close ? seg.tableToks.slice(seg.tableToks.indexOf(close) + 1).filter((x) => !isWord(x, 'AS')) : []
      const alias = after[0] && (after[0].type === 'ident' || after[0].type === 'word') ? identName(after[0]) : ''
      if (!close || !alias) { notes.add(`Could not read the subquery "${seg.tableText.slice(0, 40)}..." in FROM; it was left out.`); continue }
      const inner = sql.slice(open.end, close.start).trim()
      const innerParsed = parseSqlForBuilder(inner)
      const columns = (innerParsed.columns || []).map((c) => c.as || c.field || '').filter(Boolean)
      if (innerParsed.columns?.some((c) => c.star)) notes.add(`Subquery ${alias} selects *, so its card cannot list its columns.`)
      const t = { name: alias, alias, subquery: inner, columns, ent: false, dataView: false, prefix: '', joinType: tables.length ? (seg.joinType === ',' ? 'INNER JOIN' : seg.joinType) : null, on: null }
      if (tables.length) {
        const parsed = seg.onToks.length ? joinConditions(sql, seg.onToks, alias) : null
        t.on = parsed ? { ...parsed, raw: '' } : { conditions: [], combinator: 'AND', raw: seg.onText }
      }
      tables.push(t)
      continue
    }
    if (seg.joinType === 'CROSS APPLY' || seg.joinType === 'OUTER APPLY') {
      notes.add(`${seg.joinType} ${seg.tableText} cannot be drawn; it was left out.`)
      continue
    }
    const ref = tableRef(seg.tableToks)
    if (!ref) { notes.add(`Could not read the table "${seg.tableText}".`); continue }
    if (ref.prefix) notes.add(`${ref.prefix}.${ref.name}: the prefix was dropped.`)
    const t = { ...ref, joinType: tables.length ? (seg.joinType === ',' || seg.joinType === 'CROSS JOIN' ? 'INNER JOIN' : seg.joinType) : null, on: null }
    if (tables.length) {
      const alias = ref.alias || ref.name
      const parsed = seg.onToks.length ? joinConditions(sql, seg.onToks, alias) : null
      t.on = parsed ? { ...parsed, raw: '' } : { conditions: [], combinator: 'AND', raw: seg.onText }
    }
    tables.push(t)
  }
  if (!tables.length) return { error: [...notes].filter((n) => !n.startsWith('Comments')).join(' ') || 'No table in FROM could be read.' }

  const whereToks = clause('WHERE')
  const where = whereToks?.length ? parseCondition(sql, whereToks) : { combinator: 'AND', conditions: [] }
  const groupToks = clause('GROUP')
  const groupBy = groupToks ? splitAt(groupToks, (t) => t.type === 'comma').parts.filter((p) => p.length).map((p) => columnRef(p) || { expr: text(sql, p) }) : []
  const havingToks = clause('HAVING')
  const orderToks = clause('ORDER')
  const orderBy = orderToks ? splitAt(orderToks, (t) => t.type === 'comma').parts.filter((p) => p.length).map((p) => orderItem(sql, p)) : []
  return { tables, columns, where, having: havingToks ? text(sql, havingToks) : '', groupBy, orderBy, distinct, top, notes: [...notes], branches }
}

const SAFE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/
const lc = (s) => String(s || '').toLowerCase()

/**
 * Turns parseSqlForBuilder's result into builder state. `resolveTable(table)` finds
 * the DE or data view ({ id, name, sourceType, isDataView, fields }) or returns null;
 * unknown tables become grey "not found" cards (their fields come from the query).
 * Returns { selectedDEs, joins, where, queryOptions, notes }.
 */
export async function builderFromParsed(parsed, resolveTable) {
  const notes = [...(parsed.notes || [])]
  const resolved = await Promise.all(parsed.tables.map((t) => (t.subquery !== undefined ? null : Promise.resolve(resolveTable(t)).catch(() => null))))
  // Field names the query uses per table alias, for cards whose DE was not found.
  const used = new Map()
  const use = (alias, field) => { if (alias && field) { const k = lc(alias); if (!used.has(k)) used.set(k, new Set()); used.get(k).add(field) } }
  parsed.columns.forEach((c) => use(c.alias, c.field))
  parsed.tables.forEach((t) => (t.on?.conditions || []).forEach((c) => { use(c.leftAlias, c.leftField); use(t.alias || t.name, c.rightField) }))
  const walk = (g) => (g?.conditions || []).forEach((c) => (c.conditions ? walk(c) : use(c.alias, c.field)))
  walk(parsed.where)

  const selectedDEs = parsed.tables.map((t, i) => {
    const r = resolved[i]
    const alias = t.alias || (SAFE_ALIAS.test(t.name) ? t.name : smartAlias(t.name, parsed.tables.map((x) => x.alias).filter(Boolean)))
    if (!t.alias && !SAFE_ALIAS.test(t.name)) notes.push(`${t.name} had no alias; it is ${alias} now.`)
    if (t.subquery !== undefined) {
      return {
        id: `sub:${lc(alias)}`, name: alias, sourceType: 'subquery', subquery: t.subquery, alias, fieldsLoaded: true,
        fields: t.columns.map((name) => ({ name })), selectedFields: [],
      }
    }
    if (!r) {
      notes.push(`${t.ent ? 'ENT.' : ''}${t.name} was not found in this business unit; its card shows only the fields the query uses.`)
      return {
        id: `missing:${lc(t.name)}`, name: t.ent ? `ENT.${t.name}` : t.name, sourceType: t.ent ? 'shared' : 'dataextension',
        alias, missing: true, fieldsLoaded: true,
        fields: [...(used.get(lc(alias)) || used.get(lc(t.name)) || [])].map((name) => ({ name })),
        selectedFields: [],
      }
    }
    return { id: r.id, name: r.name, sourceType: r.sourceType, isDataView: !!r.isDataView, alias, fields: r.fields || [], fieldsLoaded: true, selectedFields: [] }
  })
  // The same DE twice (self join) needs distinct ids.
  const seen = new Map()
  selectedDEs.forEach((d) => { const n = (seen.get(d.id) || 0) + 1; seen.set(d.id, n); if (n > 1) d.id = `${d.id}#${n}` })

  const byAlias = new Map(selectedDEs.map((d) => [lc(d.alias), d]))
  parsed.tables.forEach((t, i) => { if (!byAlias.has(lc(t.name))) byAlias.set(lc(t.name), selectedDEs[i]) })
  const realName = (de, field) => (de.fields || []).find((f) => lc(f.name) === lc(field))?.name || field
  // An unqualified column belongs to the one table that has it (or the only table).
  const owner = (alias, field) => {
    if (alias) return byAlias.get(lc(alias)) || null
    if (selectedDEs.length === 1) return selectedDEs[0]
    const hits = selectedDEs.filter((d) => (d.fields || []).some((f) => lc(f.name) === lc(field)))
    return hits.length === 1 ? hits[0] : null
  }
  const ensureField = (de, field) => {
    if (!de.fields.some((f) => lc(f.name) === lc(field))) {
      de.fields = [...de.fields, { name: field }]
      if (!de.missing) notes.push(`${de.name} has no field ${field} (the query uses it).`)
    }
    return realName(de, field)
  }

  // Output columns
  const computedColumns = []
  const columnOrder = []
  let starAll = false
  parsed.columns.forEach((c, i) => {
    if (c.star) {
      if (!c.alias) { starAll = true; return }
      const de = owner(c.alias, '')
      if (de) { de.selectedFields = null; columnOrder.push(`s:${de.id}`) }
      return
    }
    if (c.expr !== undefined) {
      const id = `imp${i}`
      computedColumns.push({ id, expression: c.expr, alias: c.as || '' })
      columnOrder.push(`x:${id}`)
      return
    }
    const de = owner(c.alias, c.field)
    if (!de) {
      const id = `imp${i}`
      computedColumns.push({ id, expression: c.alias ? `${c.alias}.[${c.field}]` : `[${c.field}]`, alias: c.as || '' })
      columnOrder.push(`x:${id}`)
      return
    }
    const field = ensureField(de, c.field)
    if (Array.isArray(de.selectedFields) && !de.selectedFields.includes(field)) de.selectedFields.push(field)
    if (c.as) de.fieldAliases = { ...(de.fieldAliases || {}), [field]: c.as }
    columnOrder.push(`c:${de.id}:${field}`)
  })
  if (starAll) selectedDEs.forEach((d) => { d.selectedFields = null })

  // Joins
  const joins = []
  parsed.tables.forEach((t, i) => {
    if (!i) return
    const right = selectedDEs[i]
    const on = t.on || { conditions: [], raw: '' }
    const conds = on.conditions.map((c) => {
      const left = owner(c.leftAlias, c.leftField)
      return { left, c }
    })
    const firstLeft = conds.find((x) => x.left && selectedDEs.indexOf(x.left) < i)?.left || selectedDEs[i - 1]
    const join = { leftDeId: firstLeft.id, rightDeId: right.id, joinType: t.joinType || 'INNER JOIN', combinator: on.combinator || 'AND', conditions: [] }
    if (on.raw || conds.some((x) => !x.left || selectedDEs.indexOf(x.left) >= i)) {
      join.rawOn = true
      join.onClause = on.raw || ''
      if (!on.raw) join.onClause = on.conditions.map((c, k) => `${k ? c.conn + ' ' : ''}${c.leftAlias}.[${c.leftField}] ${c.operator} ${right.alias}.[${c.rightField}]`).join(' ')
    } else {
      join.conditions = conds.map(({ left, c }) => ({
        leftField: ensureField(left, c.leftField), operator: c.operator, rightField: ensureField(right, c.rightField), conn: c.conn || 'AND',
        ...(left.id !== firstLeft.id ? { leftDeId: left.id } : {}),
      }))
    }
    joins.push(join)
  })

  // WHERE: qualify bare columns with their table's alias.
  const mapWhere = (g) => ({
    combinator: g.combinator || 'AND',
    conditions: (g.conditions || []).map((c) => {
      if (c.conditions) return mapWhere(c)
      if (c.expr) return { expr: c.expr }
      const de = owner(c.alias, c.field)
      if (!de) return { expr: `${c.alias ? c.alias + '.' : ''}[${c.field}] ${c.operator}${c.operator.startsWith('IS ') ? '' : ' ' + (c.raw ? c.value : formatLiteral(c))}` }
      return { alias: de.alias, field: realName(de, c.field), operator: c.operator, value: c.value ?? '', raw: !!c.raw }
    }),
  })
  const where = mapWhere(parsed.where || { combinator: 'AND', conditions: [] })

  const outputNames = new Set(parsed.columns.map((c) => lc(c.as || c.field)).filter(Boolean))
  const mapItem = (g, withDir) => {
    const dir = withDir ? { dir: g.dir || 'ASC' } : {}
    if (g.expr) return { expr: g.expr, ...dir }
    if (!g.alias && outputNames.has(lc(g.field)) && parsed.columns.some((c) => lc(c.as) === lc(g.field))) return { expr: `[${g.field}]`, ...dir }
    const de = owner(g.alias, g.field)
    return de ? { alias: de.alias, field: realName(de, g.field), ...dir } : { expr: `${g.alias ? g.alias + '.' : ''}[${g.field}]`, ...dir }
  }
  const queryOptions = {
    distinct: !!parsed.distinct,
    top: parsed.top || null,
    groupBy: parsed.groupBy.map((g) => mapItem(g, false)),
    orderBy: parsed.orderBy.map((g) => mapItem(g, true)),
    computedColumns,
    having: parsed.having || '',
    columnOrder,
  }
  return { selectedDEs, joins, where, queryOptions, notes }
}

function formatLiteral(c) {
  if (c.operator === 'IN' || c.operator === 'NOT IN') return `(${String(c.value).split(',').map((v) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : `'${v.trim().replace(/'/g, "''")}'`)).join(', ')})`
  return /^-?\d+(\.\d+)?$/.test(String(c.value)) ? c.value : `'${String(c.value).replace(/'/g, "''")}'`
}
