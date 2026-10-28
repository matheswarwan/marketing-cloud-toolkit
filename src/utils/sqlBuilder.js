import { dataViewJoin } from './dataViews.js'
import { formatDEForSql } from './deCatalog.js'

/**
 * @typedef {Object} SelectedDE
 * @property {string} id
 * @property {string} name
 * @property {string} sourceType
 * @property {boolean} [isDataView]
 * @property {string[]|null} [selectedFields] - field names; null/undefined = SELECT *
 * @property {Array<{name:string,type?:number}>} [fields]
 */

/**
 * @typedef {Object} JoinCondition
 * @property {string} leftField
 * @property {string} [operator] - defaults to '='
 * @property {string} rightField
 */

/**
 * @typedef {Object} JoinSpec
 * @property {string} leftDeId
 * @property {string} rightDeId
 * @property {'INNER JOIN'|'LEFT JOIN'} joinType
 * @property {'AND'|'OR'} [combinator] - how multiple conditions combine
 * @property {JoinCondition[]} [conditions]
 * @property {string} [onClause] - legacy free-text ON (fallback)
 */

/**
 * @typedef {Object} WhereCondition
 * @property {string} [alias] - table alias (t1, t2…)
 * @property {string} field
 * @property {string} operator - =, <>, >, <, >=, <=, LIKE, NOT LIKE, IN, IS NULL, IS NOT NULL
 * @property {string} [value]
 * @property {boolean} [raw] - pass value through verbatim (functions, column refs)
 */

/**
 * @typedef {Object} WhereGroup
 * @property {'AND'|'OR'} combinator
 * @property {WhereCondition[]} conditions
 */

/** A table in FROM/JOIN: the DE's name, or a subquery in parentheses. */
export function tableSql(de) {
  if (de?.sourceType === 'subquery' || de?.subquery !== undefined) {
    const body = String(de.subquery || '').trim().split('\n').map((l) => '  ' + l).join('\n')
    return `(\n${body}\n)`
  }
  return formatDEForSql(de.name, de.sourceType)
}

export function aliasFor(index) {
  return `t${index + 1}`
}

/** Bracket a column name and qualify it with a table alias: t1.[Field]. */
export function qualifyColumn(alias, field) {
  return alias ? `${alias}.[${field}]` : `[${field}]`
}

const NO_VALUE_OPERATORS = new Set(['IS NULL', 'IS NOT NULL'])

/**
 * Build the ON expression for a single join.
 * Returns null when there is no complete condition (never invents SubscriberKey).
 */
function completeJoinConditions(join) {
  return (join?.conditions || []).filter((c) => c && c.leftField && c.rightField)
}

function conditionExpr(c, leftAlias, rightAlias, aliasById) {
  // A condition may name a third, earlier table (drawn on the canvas).
  if (c.leftDeId && aliasById?.get(c.leftDeId)) leftAlias = aliasById.get(c.leftDeId)
  return `${qualifyColumn(leftAlias, c.leftField)} ${c.operator || '='} ${qualifyColumn(rightAlias, c.rightField)}`
}

/** Connector linking a condition to the previous one (per-condition, falling back to the join default). */
function connectorFor(c, defaultComb) {
  return c?.conn === 'OR' || c?.conn === 'AND' ? c.conn : defaultComb
}

/**
 * Build the ON expression for a single join (single line).
 * Supports per-condition connectors so `a AND b OR c` (which SQL reads as
 * `(a AND b) OR c` by precedence) is expressible.
 * Returns null when there is no complete condition (never invents SubscriberKey).
 */
export function buildOnExpression(join, leftAlias, rightAlias, aliasById) {
  if (join?.rawOn && join.onClause && join.onClause.trim()) return join.onClause.trim()
  const conditions = completeJoinConditions(join)
  if (conditions.length) {
    const defaultComb = join.combinator === 'OR' ? 'OR' : 'AND'
    return conditions
      .map((c, i) => (i === 0 ? conditionExpr(c, leftAlias, rightAlias, aliasById)
        : `${connectorFor(c, defaultComb)} ${conditionExpr(c, leftAlias, rightAlias, aliasById)}`))
      .join(' ')
  }
  if (join?.onClause && join.onClause.trim()) return join.onClause.trim()
  return null
}

/**
 * Build the ON block for a join, placing each additional condition on its own
 * indented line for readability. Returns null when no complete condition.
 */
export function buildOnBlock(join, leftAlias, rightAlias, aliasById) {
  if (join?.rawOn && join.onClause && join.onClause.trim()) return join.onClause.trim()
  const conditions = completeJoinConditions(join)
  if (conditions.length) {
    const defaultComb = join.combinator === 'OR' ? 'OR' : 'AND'
    return conditions
      .map((c, i) => (i === 0 ? conditionExpr(c, leftAlias, rightAlias, aliasById)
        : `\n    ${connectorFor(c, defaultComb)} ${conditionExpr(c, leftAlias, rightAlias, aliasById)}`))
      .join('')
  }
  if (join?.onClause && join.onClause.trim()) return join.onClause.trim()
  return null
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''")
}

function looksNumeric(value) {
  return /^-?\d+(\.\d+)?$/.test(String(value).trim())
}

function formatWhereValue(cond) {
  if (NO_VALUE_OPERATORS.has(cond.operator)) return ''
  const value = cond.value ?? ''
  if (cond.raw) return value
  if (cond.operator === 'IN' || cond.operator === 'NOT IN') {
    const parts = String(value)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (looksNumeric(p) ? p : `'${escapeSqlString(p)}'`))
    return `(${parts.join(', ')})`
  }
  if (looksNumeric(value)) return value
  return `'${escapeSqlString(value)}'`
}

function formatWhereCondition(cond) {
  // A condition the builder cannot model, kept as written (from SQL import).
  if (cond.expr) return cond.expr
  const field = qualifyColumn(cond.alias, cond.field)
  if (NO_VALUE_OPERATORS.has(cond.operator)) {
    return `${field} ${cond.operator}`
  }
  return `${field} ${cond.operator} ${formatWhereValue(cond)}`
}

/**
 * Build a WHERE clause body (without the leading WHERE keyword).
 * @param {WhereGroup} where
 */
export function buildWhereBody(where, indent = '  ') {
  const parts = (where?.conditions || [])
    .map((c) => {
      if (!c) return ''
      // A nested group (AND inside OR, or the other way round) in parentheses.
      if (Array.isArray(c.conditions)) {
        const inner = buildWhereBody(c, indent + '  ')
        return inner ? `(${inner})` : ''
      }
      if (c.expr && String(c.expr).trim()) return String(c.expr).trim()
      return c.field && c.operator ? formatWhereCondition(c) : ''
    })
    .filter(Boolean)
  if (!parts.length) return ''
  const combinator = where.combinator === 'OR' ? 'OR' : 'AND'
  return parts.join(`\n${indent}${combinator} `)
}

/**
 * Resolve the output field names for a DE.
 * - explicit selection => those fields
 * - null selection => all known fields (SELECT * is expanded, never emitted)
 * Returns null when nothing is known yet (fields not loaded).
 */
function outputFieldNames(de) {
  if (Array.isArray(de.selectedFields)) return de.selectedFields
  const all = (de.fields || []).map((f) => f.name)
  return all.length ? all : null
}

/**
 * Build the SELECT column list, expanding every DE's fields and prefixing any
 * column name that collides across DEs with its table alias (e.g. t1_JobID).
 */
export function buildSelectColumns(selectedDEs) {
  return selectColumnItems(selectedDEs).map((c) => c.sql)
}

/** Output column key, for `queryOptions.columnOrder`. */
export const columnKey = (deId, field) => `c:${deId}:${field}`
export const computedKey = (c, i) => `x:${c?.id || i}`

/**
 * The SELECT items for the ticked fields, as { key, sql, name }. A field's output
 * name comes from the DE's `fieldAliases` (from SQL import or the Output list), else
 * clashing names get the table alias (t1_JobID).
 */
export function selectColumnItems(selectedDEs) {
  const cols = []
  selectedDEs.forEach((de, i) => {
    const alias = aliasOf(de, i)
    const names = outputFieldNames(de)
    if (names === null) {
      // Fields not loaded yet — fall back to * for this DE only.
      cols.push({ alias, star: true, deId: de.id })
    } else {
      names.forEach((field) => cols.push({ alias, field, deId: de.id, as: de.fieldAliases?.[field] || '' }))
    }
  })

  const counts = {}
  cols.forEach((c) => {
    if (c.field) {
      const k = c.field.toLowerCase()
      counts[k] = (counts[k] || 0) + 1
    }
  })

  return cols.map((c) => {
    if (c.star) return { key: `s:${c.deId}`, sql: `${c.alias}.*`, name: '*' }
    const base = qualifyColumn(c.alias, c.field)
    const key = columnKey(c.deId, c.field)
    if (c.as) return { key, sql: `${base} AS [${c.as}]`, name: c.as }
    const isDuplicate = counts[c.field.toLowerCase()] > 1
    return isDuplicate ? { key, sql: `${base} AS [${c.alias}_${c.field}]`, name: `${c.alias}_${c.field}` } : { key, sql: base, name: c.field }
  })
}

/** Orders items by `order` (keys); items not listed keep their place after the listed ones. */
export function applyColumnOrder(items, order) {
  if (!Array.isArray(order) || !order.length) return items
  const rank = new Map(order.map((k, i) => [k, i]))
  return items
    .map((it, i) => ({ it, i, r: rank.has(it.key) ? rank.get(it.key) : order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.it)
}

/** GROUP BY / ORDER BY item: a column, an output column name, or an expression. */
function itemSql(g) {
  if (g.expr) return g.expr
  return qualifyColumn(g.alias, g.field)
}

/**
 * Build SELECT/FROM/JOIN/WHERE SQL from selected DEs, joins and filters.
 * @param {SelectedDE[]} selectedDEs
 * @param {JoinSpec[]} joins
 * @param {WhereGroup} [where]
 */
/** Effective alias for a DE: its custom alias, or the positional default. */
export function aliasOf(de, index) {
  const custom = (de?.alias || '').trim()
  return custom || aliasFor(index)
}

/**
 * Build the SELECT column list including any computed/aggregate columns.
 * When GROUP BY is active, base columns become the grouped columns (so the
 * query stays valid) plus any computed columns.
 */
export function selectListItems(selectedDEs, opts = {}) {
  const groupBy = normalizeColumns(opts.groupBy)
  const computedAll = Array.isArray(opts.computedColumns) ? opts.computedColumns : []
  let base
  if (groupBy.length) {
    // Grouped: the grouped columns (with the DE's alias for the name, if any).
    const byAlias = new Map(selectedDEs.map((de, i) => [aliasOf(de, i).toLowerCase(), de]))
    base = groupBy.filter((g) => !g.expr).map((g) => {
      const de = byAlias.get(String(g.alias || '').toLowerCase())
      const as = de?.fieldAliases?.[g.field]
      const key = de ? columnKey(de.id, g.field) : `g:${g.alias}.${g.field}`
      return { key, sql: as ? `${qualifyColumn(g.alias, g.field)} AS [${as}]` : qualifyColumn(g.alias, g.field), name: as || g.field }
    })
  } else {
    base = selectColumnItems(selectedDEs)
  }
  const computedCols = computedAll
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c && (c.expression || '').trim())
    .map(({ c, i }) => {
      const expr = c.expression.trim()
      const alias = (c.alias || '').trim()
      return { key: computedKey(c, i), sql: alias ? `${expr} AS [${alias}]` : expr, name: alias || expr }
    })
  return applyColumnOrder([...base, ...computedCols], opts.columnOrder)
}

function buildSelectList(selectedDEs, opts) {
  const all = selectListItems(selectedDEs, opts).map((c) => c.sql)
  return all.length ? all : ['*']
}

function normalizeColumns(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && (c.field || c.expr))
}

/**
 * @typedef {Object} QueryOptions
 * @property {boolean} [distinct]
 * @property {number|string|null} [top]
 * @property {Array<{alias:string, field:string}>} [groupBy]
 * @property {Array<{alias:string, field:string, dir:'ASC'|'DESC'}>} [orderBy]
 * @property {Array<{expression:string, alias:string}>} [computedColumns]
 */

export function buildSqlFromSelections(selectedDEs, joins = [], where = null, options = null) {
  if (!selectedDEs.length) return ''

  const opts = options || {}
  const aliasById = new Map(selectedDEs.map((de, i) => [de.id, aliasOf(de, i)]))

  const fieldLines = buildSelectList(selectedDEs, opts).map((c) => `  ${c}`)

  const distinct = opts.distinct ? ' DISTINCT' : ''
  const topNum = parseInt(opts.top, 10)
  const top = Number.isFinite(topNum) && topNum > 0 ? ` TOP ${topNum}` : ''

  const lines = [`SELECT${distinct}${top}`, fieldLines.join(',\n')]

  const first = selectedDEs[0]
  lines.push(`FROM ${tableSql(first)} AS ${aliasOf(first, 0)}`)

  for (let i = 1; i < selectedDEs.length; i++) {
    const de = selectedDEs[i]
    const join = joins.find((j) => j.rightDeId === de.id) || joins[i - 1]
    const joinType = join?.joinType || 'INNER JOIN'
    const leftAlias =
      (join?.leftDeId && aliasById.get(join.leftDeId)) || aliasOf(selectedDEs[i - 1], i - 1)
    const rightAlias = aliasOf(de, i)
    const onExpr = buildOnBlock(join || {}, leftAlias, rightAlias, aliasById)
    const tableExpr = `${tableSql(de)} AS ${rightAlias}`
    if (onExpr) {
      lines.push(`${joinType} ${tableExpr} ON ${onExpr}`)
    } else {
      lines.push(`${joinType} ${tableExpr} ON /* TODO: set join condition */`)
    }
  }

  const whereBody = buildWhereBody(where)
  if (whereBody) lines.push(`WHERE ${whereBody}`)

  const groupBy = normalizeColumns(opts.groupBy)
  if (groupBy.length) {
    lines.push(`GROUP BY ${groupBy.map(itemSql).join(', ')}`)
  }

  const having = String(opts.having || '').trim()
  if (having) lines.push(`HAVING ${having}`)

  const orderBy = normalizeColumns(opts.orderBy)
  if (orderBy.length) {
    lines.push(`ORDER BY ${orderBy.map((o) => `${itemSql(o)} ${o.dir === 'DESC' ? 'DESC' : 'ASC'}`).join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Rank candidate join field pairs between two DEs.
 * Data views use their known joins (dataViewJoin). Otherwise the first shared field
 * name, preferring SubscriberKey, ContactKey, EmailAddress, Id and JobID.
 * Returns [] when no shared field is found (does NOT fall back to SubscriberKey).
 * @returns {JoinCondition[]}
 */
export function suggestJoinConditions(leftDe, rightDe) {
  // Data views have documented relationships (some on differently named columns).
  const known = dataViewJoin(leftDe, rightDe)
  if (known) return known
  const leftFields = leftDe?.fields || []
  const rightFields = rightDe?.fields || []
  const leftByLower = new Map(leftFields.map((f) => [f.name.toLowerCase(), f.name]))
  const priorities = ['subscriberkey', 'contactkey', 'emailaddress', 'id', 'jobid']

  for (const p of priorities) {
    const rightMatch = rightFields.find((f) => f.name.toLowerCase() === p)
    if (rightMatch && leftByLower.has(p)) {
      return [{ leftField: leftByLower.get(p), operator: '=', rightField: rightMatch.name }]
    }
  }
  for (const rf of rightFields) {
    const ln = rf.name.toLowerCase()
    if (leftByLower.has(ln)) {
      return [{ leftField: leftByLower.get(ln), operator: '=', rightField: rf.name }]
    }
  }
  return []
}

/**
 * Legacy helper: suggest a single ON clause string, or null if no match.
 * @deprecated prefer suggestJoinConditions
 */
export function suggestOnClause(leftDe, rightDe, leftAlias, rightAlias) {
  const conditions = suggestJoinConditions(leftDe, rightDe)
  if (!conditions.length) return null
  const c = conditions[0]
  return `${leftAlias}.${c.leftField} = ${rightAlias}.${c.rightField}`
}

/**
 * Build SQL from a visual graph (nodes + edges).
 * @param {Array<{id:string,data:SelectedDE}>} nodes
 * @param {Array<{source:string,target:string,data?:JoinSpec}>} edges
 * @param {WhereGroup} [where]
 */
export function buildSqlFromGraph(nodes, edges, where = null, options = null) {
  if (!nodes.length) return ''
  const ordered = topologicalOrder(nodes, edges)
  const selectedDEs = ordered.map((n) => n.data)
  const pos = new Map(ordered.map((n, i) => [n.id, i]))
  const joins = edges.map((e) => {
    // Orient the edge so the earlier table (already in FROM) is the left side
    // and the later, newly-joined table is the right side. Swap the condition
    // fields to match, so column aliases never collapse onto one table.
    const flip = (pos.get(e.source) ?? 0) > (pos.get(e.target) ?? 0)
    const conditions = (e.data?.conditions || []).map((c) =>
      flip ? { ...c, leftField: c.rightField, rightField: c.leftField } : c)
    return {
      leftDeId: flip ? e.target : e.source,
      rightDeId: flip ? e.source : e.target,
      joinType: e.data?.joinType || 'INNER JOIN',
      combinator: e.data?.combinator || 'AND',
      conditions,
      onClause: e.data?.onClause || '',
      rawOn: !!e.data?.rawOn,
    }
  })
  return buildSqlFromSelections(selectedDEs, joins, where, options)
}

/**
 * Resolve the tables (with their resolved alias + flat field-name list) for a
 * list-mode selection. Used to build WHERE/GROUP BY/ORDER BY field pickers so
 * their aliases always match the generated SQL.
 * @returns {Array<{deId:string, name:string, alias:string, fields:string[]}>}
 */
export function resolveSelectionTables(selectedDEs = []) {
  return selectedDEs.map((de, i) => ({
    deId: de.id,
    name: de.name,
    alias: aliasOf(de, i),
    fields: (de.fields || []).map((f) => f.name),
  }))
}

/**
 * Resolve the tables for a visual graph, in the same topological order the SQL
 * builder uses, so picker aliases (t1/t2…) line up with the emitted query.
 * @returns {Array<{deId:string, name:string, alias:string, fields:string[]}>}
 */
export function resolveGraphTables(nodes = [], edges = []) {
  if (!nodes.length) return []
  const ordered = topologicalOrder(nodes, edges)
  return resolveSelectionTables(ordered.map((n) => n.data))
}

/** Flatten resolved tables into {alias, field, label} picker options. */
export function fieldOptionsFromTables(tables = []) {
  return tables.flatMap((t) =>
    (t.fields || []).map((field) => ({
      alias: t.alias,
      field,
      label: `${t.alias}.${field}`,
      deName: t.name,
    }))
  )
}

function topologicalOrder(nodes, edges) {
  if (!edges.length) return nodes
  const idToNode = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const visited = new Set()
  const result = []
  const start = nodes[0]
  function walk(id) {
    if (visited.has(id)) return
    visited.add(id)
    const node = idToNode[id]
    if (node) result.push(node)
    for (const e of edges) {
      if (e.source === id) walk(e.target)
    }
  }
  walk(start.id)
  for (const n of nodes) if (!visited.has(n.id)) result.push(n)
  return result
}
