// Data model map (user, 2026-11-17: "look like SFMC, click and view contents, do things
// with it"). Like Data Designer: an overview of the attribute groups around Contacts,
// then one group as cards (attribute sets with their fields) linked left to right with
// the cardinality at each end. Clicking a card opens its details and actions
// (components/dataModel). Model from utils/dataModel.js; layout by dagre.
import * as dagre from '@dagrejs/dagre'

export const CARD_W = 260
export const CARD_HEAD = 46
export const FIELD_ROW = 20
export const MAX_FIELDS = 8
export const GROUP_W = 200
export const GROUP_H = 64

const idOf = (v) => String(v ?? '').toLowerCase()
const visibleFields = (set) => (set.fields || []).filter((f) => !f.hidden)

/** Card height for a set: its header, up to MAX_FIELDS fields and a "+N more" row. */
export function cardHeight(set) {
  const n = visibleFields(set).length
  const rows = Math.min(n, MAX_FIELDS) + (n > MAX_FIELDS ? 1 : 0)
  return CARD_HEAD + Math.max(rows, 1) * FIELD_ROW + 8
}

/** 'one' or 'many' from SFMC's cardinality (anything but Many is one). */
export const endOf = (c) => (String(c || '').toLowerCase() === 'many' ? 'many' : 'one')

/**
 * One group as a map: { nodes, edges, width, height }. Nodes: the group (kind 'group')
 * and its sets (kind 'set', with the set). Edges run away from the group (by distance
 * from it), each with the cardinality at its source and target end and the join fields.
 */
export function layoutGroupMap(group) {
  const gid = idOf(group.id)
  const sets = new Map(group.sets.map((s) => [idOf(s.id), s]))
  // Distance from the group, so every line points away from it.
  const level = new Map([[gid, 0]])
  const queue = [gid]
  while (queue.length) {
    const at = queue.shift()
    for (const r of group.links) {
      const a = idOf(r.left.id)
      const b = idOf(r.right.id)
      const other = a === at ? b : b === at ? a : null
      if (other && !level.has(other) && (sets.has(other) || other === gid)) { level.set(other, level.get(at) + 1); queue.push(other) }
    }
  }
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 110, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  g.setNode(gid, { width: GROUP_W, height: GROUP_H })
  for (const [k, s] of sets) g.setNode(k, { width: CARD_W, height: cardHeight(s) })
  const edges = []
  for (const r of group.links) {
    let a = idOf(r.left.id)
    let b = idOf(r.right.id)
    if (!g.hasNode(a) || !g.hasNode(b) || a === b) continue
    let [from, to] = [r.left, r.right]
    if ((level.get(a) ?? 99) > (level.get(b) ?? 99)) { [a, b] = [b, a]; [from, to] = [to, from] }
    const id = String(r.id)
    g.setEdge(a, b, {}, id)
    const pairs = r.fields.map((f) => (from === r.left ? `${f.left || '?'} = ${f.right || '?'}` : `${f.right || '?'} = ${f.left || '?'}`))
    edges.push({ id, source: a, target: b, sourceEnd: endOf(from.cardinality), targetEnd: endOf(to.cardinality), fields: pairs.join(', '), link: r })
  }
  dagre.layout(g)
  const at = (k, w, h) => { const p = g.node(k); return { x: p.x - w / 2, y: p.y - h / 2 } }
  const nodes = [{ id: gid, kind: 'group', group, w: GROUP_W, h: GROUP_H, ...at(gid, GROUP_W, GROUP_H) }]
  for (const [k, s] of sets) nodes.push({ id: k, kind: 'set', set: s, w: CARD_W, h: cardHeight(s), ...at(k, CARD_W, cardHeight(s)) })
  const graph = g.graph()
  return { nodes, edges, width: Math.ceil(graph.width || 0), height: Math.ceil(graph.height || 0) }
}

/** The fields a card shows, and how many more there are. */
export function cardFields(set) {
  const all = visibleFields(set)
  return { shown: all.slice(0, MAX_FIELDS), more: Math.max(0, all.length - MAX_FIELDS) }
}

/** A field's type as Data Designer writes it: "Text (256)", "Number", "Decimal (18,2)". */
export function fieldTypeText(f) {
  if (!f?.type) return ''
  return f.length && /text|email|phone|locale/i.test(f.type) ? `${f.type} (${f.length})` : f.type
}

/**
 * The overview: groups on a circle around Contacts, the circle big enough that the
 * bubbles do not touch. { size, items: [{ group, x, y }] } (centres, in a size x size box).
 */
export function overviewLayout(groups, { bubble = 116, gap = 14, min = 520 } = {}) {
  const n = groups.length
  const r = n <= 1 ? 0 : Math.max(min / 2 - bubble / 2 - 8, ((bubble + gap) * n) / (2 * Math.PI))
  const size = Math.ceil(Math.max(min, 2 * r + bubble + 16))
  const c = size / 2
  const items = groups.map((group, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1)
    return { group, x: c + r * Math.cos(a), y: c + r * Math.sin(a) }
  })
  return { size, items }
}

// ── Queries ──────────────────────────────────────────────
const br = (s) => `[${String(s).replace(/]/g, ']]')}]`

/** SELECT TOP 100 of a set's columns from its data extension (`deName`, ENT. included). */
export function setSql(set, deName) {
  const cols = visibleFields(set).map((f) => f.column).filter(Boolean)
  const list = cols.length && cols.length <= 40 ? cols.map((c) => `  ${br(c)}`).join(',\n') : '  *'
  return `SELECT TOP 100\n${list}\nFROM ${deNameSql(deName)}`
}

// A DE name in SQL: ENT. stays outside the brackets.
function deNameSql(name) {
  const m = /^ENT\.(.+)$/i.exec(String(name))
  return m ? `ENT.${br(m[1])}` : br(name)
}

/**
 * A JOIN of two linked sets on the link's columns, or null when the link has no column
 * pairs or one end is not a set. `names` maps set id to its data extension name.
 * Columns of the second set that the first also has are left out (one name per column
 * keeps the result saveable to a data extension).
 */
export function joinSql(link, setById, names) {
  const a = setById.get(idOf(link.left.id))
  const b = setById.get(idOf(link.right.id))
  if (!a || !b || link.left.kind !== 'set' || link.right.kind !== 'set') return null
  const col = (set, id) => set.fields.find((f) => idOf(f.id) === idOf(id))?.column
  const on = link.fields.map((p) => [col(a, p.leftId) || p.left, col(b, p.rightId) || p.right]).filter(([x, y]) => x && y)
  if (!on.length) return null
  const aCols = visibleFields(a).map((f) => f.column).filter(Boolean)
  const taken = new Set(aCols.map((c) => c.toLowerCase()))
  const bCols = visibleFields(b).map((f) => f.column).filter((c) => c && !taken.has(c.toLowerCase()))
  const select = [...aCols.map((c) => `  a.${br(c)}`), ...bCols.map((c) => `  b.${br(c)}`)]
  return [
    'SELECT TOP 100',
    select.length ? select.join(',\n') : '  a.*',
    `FROM ${deNameSql(names.get(idOf(a.id)) || a.name)} a`,
    `INNER JOIN ${deNameSql(names.get(idOf(b.id)) || b.name)} b`,
    on.map(([x, y], i) => `  ${i ? 'AND' : 'ON'} a.${br(x)} = b.${br(y)}`).join('\n'),
  ].join('\n')
}

// ── Search ───────────────────────────────────────────────
/**
 * Sets whose name, or a field's name or column, contains `q` (any case), each with the
 * group it is in (null for a set in no group) and the matching fields.
 */
export function searchModel(model, q) {
  const term = String(q || '').trim().toLowerCase()
  if (!term || !model) return []
  const groupOf = new Map()
  for (const g of model.groups) for (const s of g.sets) if (!groupOf.has(idOf(s.id))) groupOf.set(idOf(s.id), g)
  const out = []
  for (const s of model.sets) {
    const byName = s.name.toLowerCase().includes(term)
    const fields = (s.fields || []).filter((f) => f.name.toLowerCase().includes(term) || f.column.toLowerCase().includes(term))
    if (byName || fields.length) out.push({ set: s, group: groupOf.get(idOf(s.id)) || null, fields: byName ? [] : fields })
  }
  return out.sort((x, y) => (y.fields.length === 0) - (x.fields.length === 0) || x.set.name.localeCompare(y.set.name)).slice(0, 50)
}
