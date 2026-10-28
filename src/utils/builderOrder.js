// Reordering the Query Builder's data extensions (feedback #90). The first one is
// the FROM table; each next one joins the one before it. Aliases are fixed first so
// WHERE conditions, output fields and options keep pointing at the same tables.
import { aliasOf } from './sqlBuilder.js'

const withAliases = (list) => list.map((d, i) => ({ ...d, alias: aliasOf(d, i) }))

/** Moves the item at `from` so it ends up at index `to`. */
export function moveDE(list, from, to) {
  const next = withAliases(list)
  if (from === to || from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Swaps the items at `a` and `b`. */
export function swapDEs(list, a, b) {
  const next = withAliases(list)
  if (a === b || !next[a] || !next[b]) return next
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

const FLIP = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }

const flipCondition = (c) => ({ ...c, leftField: c.rightField, rightField: c.leftField, operator: FLIP[c.operator] || c.operator })

/**
 * One join for every table after the first: the join that brings it in from any
 * earlier table, or a join with an earlier table that ran the other way, turned
 * around (sides and operators flipped), else a new empty LEFT JOIN to the table
 * before it. So joins form a tree (the visual builder can join C to A, not only
 * to B).
 */
export function joinsForOrder(list, joins = []) {
  const out = []
  const used = new Set()
  for (let i = 1; i < list.length; i++) {
    const right = list[i].id
    const earlier = new Set(list.slice(0, i).map((d) => d.id))
    const same = joins.find((j) => !used.has(j) && j.rightDeId === right && earlier.has(j.leftDeId))
    if (same) { used.add(same); out.push(same); continue }
    const rev = joins.find((j) => !used.has(j) && j.leftDeId === right && earlier.has(j.rightDeId))
    if (rev) {
      used.add(rev)
      out.push({ ...rev, leftDeId: rev.rightDeId, rightDeId: right, conditions: (rev.conditions || []).map(flipCondition) })
      continue
    }
    out.push({ leftDeId: list[i - 1].id, rightDeId: right, joinType: 'LEFT JOIN', combinator: 'AND', conditions: [] })
  }
  return out
}

/**
 * Puts `rootId` first (the FROM table), then the others breadth first along the
 * joins, so every table comes after the table it joins to. Tables with no joined
 * path keep their relative order at the end.
 */
export function orderFromRoot(list, joins = [], rootId) {
  const byId = new Map(withAliases(list).map((d) => [d.id, d]))
  if (!byId.has(rootId)) return withAliases(list)
  const seen = new Set([rootId])
  const queue = [rootId]
  const out = []
  while (queue.length) {
    const id = queue.shift()
    out.push(byId.get(id))
    for (const d of list) {
      if (seen.has(d.id)) continue
      const linked = joins.some((j) => (j.leftDeId === id && j.rightDeId === d.id) || (j.rightDeId === id && j.leftDeId === d.id))
      if (linked) { seen.add(d.id); queue.push(d.id) }
    }
  }
  for (const d of list) if (!seen.has(d.id)) out.push(byId.get(d.id))
  return out
}

/**
 * Adds a join condition between a field of one table and a field of another (drawn
 * on the canvas). The later table is the joined side. Its join gets the condition
 * when it already joins the other table, or takes the other table when it has no
 * condition yet; otherwise the condition names the other table itself (leftDeId),
 * which SQL allows in ON.
 */
export function addJoinCondition(list, joins, a, b) {
  const ia = list.findIndex((d) => d.id === a.deId)
  const ib = list.findIndex((d) => d.id === b.deId)
  if (ia < 0 || ib < 0 || ia === ib) return joins
  const [left, right] = ia < ib ? [a, b] : [b, a]
  const next = joinsForOrder(list, joins).map((j) => ({ ...j, conditions: [...(j.conditions || [])] }))
  const join = next.find((j) => j.rightDeId === right.deId)
  if (!join) return next
  const cond = { leftField: left.field, operator: '=', rightField: right.field, conn: 'AND' }
  const complete = join.conditions.filter((c) => c.leftField && c.rightField)
  if (join.leftDeId === left.deId) {
    if (complete.some((c) => !c.leftDeId && c.leftField === left.field && c.rightField === right.field)) return next
    join.conditions = [...complete, cond]
  } else if (!complete.length && !join.rawOn) {
    join.leftDeId = left.deId
    join.conditions = [cond]
  } else {
    join.conditions = [...complete, { ...cond, leftDeId: left.deId }]
  }
  return next
}

/**
 * Turns a saved visual-mode graph (builder records before the shared model) into
 * the list model: tables in join order, one join per table, positions by id.
 */
export function graphToModel(selectedDEs = [], graphNodes = [], graphEdges = []) {
  const byId = new Map(selectedDEs.map((d) => [d.id, d]))
  for (const n of graphNodes) if (n?.id && !byId.has(n.id) && n.data) byId.set(n.id, { ...n.data, id: n.id })
  const joins = graphEdges.map((e) => ({
    leftDeId: e.source,
    rightDeId: e.target,
    joinType: e.data?.joinType || 'INNER JOIN',
    combinator: e.data?.combinator || 'AND',
    conditions: (e.data?.conditions || []).map((c) => ({ ...c })),
    onClause: e.data?.onClause || '',
    rawOn: !!e.data?.rawOn,
  }))
  const first = graphNodes[0]?.id || selectedDEs[0]?.id
  const list = orderFromRoot([...byId.values()], joins, first)
  const layout = {}
  for (const n of graphNodes) if (n?.id && Number.isFinite(n.x) && Number.isFinite(n.y)) layout[n.id] = { x: n.x, y: n.y }
  return { selectedDEs: list, joins: joinsForOrder(list, joins), layout }
}

// Table aliases (feedback #150): short, lower case, from the table's name, so a column
// reads as which table it comes from (`cm.[Email]` for Customer Master), unique in the
// query and never a SQL keyword. Data views get the aliases people commonly use.
const DATA_VIEW_ALIASES = {
  _SUBSCRIBERS: 'sub', _SENT: 's', _OPEN: 'o', _CLICK: 'c', _BOUNCE: 'b', _JOB: 'j', _UNSUBSCRIBE: 'u',
  _COMPLAINT: 'cp', _LISTSUBSCRIBERS: 'ls', _ENTERPRISEATTRIBUTE: 'ea', _JOURNEY: 'jr', _JOURNEYACTIVITY: 'ja',
  _FTAF: 'ftaf', _AUTOMATIONINSTANCE: 'ai', _AUTOMATIONACTIVITYINSTANCE: 'aai', _BUSINESSUNITUNSUBSCRIBES: 'buu',
  _MOBILEADDRESS: 'ma', _MOBILESUBSCRIPTION: 'msub', _SMSMESSAGETRACKING: 'smt', _SMSSUBSCRIPTIONLOG: 'ssl',
  _UNDELIVERABLESMS: 'usms', _PUSHADDRESS: 'pa', _PUSHTAG: 'pt', _COUPON: 'cou', _SURVEYRESPONSE: 'sr',
}
const ALIAS_STOP = new Set(['as', 'at', 'by', 'if', 'in', 'is', 'of', 'on', 'or', 'to', 'add', 'all', 'and', 'any', 'asc', 'end', 'for', 'key', 'not', 'set', 'top', 'use', 'desc', 'from', 'join', 'left', 'full', 'into', 'null', 'over', 'case', 'when', 'then', 'else', 'with', 'user', 'view', 'open', 'file', 'proc', 'rule', 'save', 'tran', 'kill', 'load', 'dump', 'exec', 'drop', 'deny', 'read', 'some', 'table'])

export function smartAlias(name, taken = []) {
  const used = new Set([...taken].map((a) => String(a || '').toLowerCase()))
  const bare = String(name || '').replace(/^ENT\./i, '').replace(/[[\]]/g, '').trim()
  let base = DATA_VIEW_ALIASES[bare.toUpperCase()]
  if (!base) {
    const words = bare.replace(/^_+/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean)
    const letters = (w) => w.replace(/[^A-Za-z]/g, '')
    if (words.length >= 2) base = words.map((w) => letters(w)[0] || '').join('').slice(0, 3)
    else base = letters(words[0] || '').slice(0, 3)
    base = base.toLowerCase() || 't'
  }
  if (ALIAS_STOP.has(base)) base = `${base}1`
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
}
