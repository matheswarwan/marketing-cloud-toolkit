// Visual Query Builder (Vue Flow canvas): the pure parts. The canvas draws the same
// model as the List view (selectedDEs in FROM/JOIN order, one join per table after
// the first) plus a `layout` of card positions by DE id.
import * as dagre from '@dagrejs/dagre'
import { aliasOf } from './sqlBuilder.js'

export const CARD_W = 240
export const HEADER_H = 40
export const ROW_H = 24
export const FOOTER_H = 26
/** Cards with more fields than this show the joined, ticked and key fields first. */
export const FOLD_AT = 12

export const JOIN_TYPES = [
  { value: 'INNER JOIN', label: 'Inner' },
  { value: 'LEFT JOIN', label: 'Left' },
  { value: 'RIGHT JOIN', label: 'Right' },
  { value: 'FULL OUTER JOIN', label: 'Full' },
]
export const joinLabel = (type) => JOIN_TYPES.find((j) => j.value === type)?.label || 'Inner'

/** Handle ids: a field row has one on each side; the header has one too (joins with no field pair). */
export const fieldHandle = (index, side) => `f${index}-${side}`
export const headerHandle = (side) => `h-${side}`
export function parseHandle(id) {
  const m = /^f(\d+)-[lr]$/.exec(id || '')
  return m ? Number(m[1]) : null
}

const isKey = (f) => !!(f?.isPrimaryKey || f?.isKey || f?.primaryKey)

/** Field names that take part in a join, per DE id. */
export function joinedFields(selectedDEs = [], joins = []) {
  const out = new Map(selectedDEs.map((d) => [d.id, new Set()]))
  for (const j of joins) {
    if (j.rawOn) continue
    for (const c of j.conditions || []) {
      if (!c.leftField || !c.rightField) continue
      out.get(c.leftDeId || j.leftDeId)?.add(c.leftField)
      out.get(j.rightDeId)?.add(c.rightField)
    }
  }
  return out
}

/**
 * The field rows a card shows: every field when it has few, when `showAll`, or
 * when searching (matches only); otherwise joined, ticked and key fields first, then
 * the rest up to FOLD_AT. Joined fields are always kept, since edges attach to them.
 * Returns [{ field, index }] in the DE's field order and how many are hidden.
 */
export function visibleRows(de, joined = new Set(), { showAll = false, search = '' } = {}) {
  const fields = de?.fields || []
  const all = fields.map((field, index) => ({ field, index }))
  const q = search.trim().toLowerCase()
  if (q) {
    const rows = all.filter((r) => joined.has(r.field.name) || r.field.name.toLowerCase().includes(q))
    return { rows, hidden: fields.length - rows.length }
  }
  if (showAll || fields.length <= FOLD_AT) return { rows: all, hidden: 0 }
  const ticked = new Set(Array.isArray(de.selectedFields) ? de.selectedFields : [])
  const keep = new Set()
  for (const r of all) if (joined.has(r.field.name) || ticked.has(r.field.name) || isKey(r.field)) keep.add(r.index)
  for (const r of all) { if (keep.size >= FOLD_AT) break; keep.add(r.index) }
  const rows = all.filter((r) => keep.has(r.index))
  return { rows, hidden: fields.length - rows.length }
}

export function cardHeight(rowCount, hidden = 0) {
  return HEADER_H + Math.max(1, rowCount) * ROW_H + (hidden ? FOOTER_H : 0) + 8
}

/**
 * Edges for the canvas: one per complete join condition (field to field), or one
 * header-to-header edge for a join with no complete condition or a raw ON. The join
 * type pill goes on the first edge of each join. Sides follow the card positions,
 * so lines leave the side that faces the other card.
 */
export function canvasEdges(selectedDEs = [], joins = [], layout = {}) {
  const byId = new Map(selectedDEs.map((d, i) => [d.id, { de: d, i }]))
  const fieldIndex = (deId, name) => (byId.get(deId)?.de.fields || []).findIndex((f) => f.name === name)
  const x = (id) => layout[id]?.x ?? (byId.get(id)?.i || 0) * (CARD_W + 120)
  const sides = (a, b) => (x(a) <= x(b) ? ['r', 'l'] : ['l', 'r'])
  const edges = []
  for (const j of joins) {
    const right = byId.get(j.rightDeId)
    if (!right) continue
    const base = { joinType: j.joinType || 'INNER JOIN', rightDeId: j.rightDeId }
    const complete = j.rawOn ? [] : (j.conditions || []).map((c, ci) => ({ c, ci })).filter(({ c }) => c.leftField && c.rightField)
    let labelled = false
    for (const { c, ci } of complete) {
      const left = c.leftDeId || j.leftDeId
      const li = fieldIndex(left, c.leftField)
      const ri = fieldIndex(j.rightDeId, c.rightField)
      if (!byId.has(left) || li < 0 || ri < 0) continue
      const [ls, rs] = sides(left, j.rightDeId)
      edges.push({
        id: `j:${j.rightDeId}:${ci}`,
        source: left,
        target: j.rightDeId,
        sourceHandle: fieldHandle(li, ls),
        targetHandle: fieldHandle(ri, rs),
        type: 'join',
        data: { ...base, label: !labelled, operator: c.operator || '=', conn: ci ? (c.conn || j.combinator || 'AND') : '' },
      })
      labelled = true
    }
    if (!labelled && byId.has(j.leftDeId)) {
      const [ls, rs] = sides(j.leftDeId, j.rightDeId)
      edges.push({
        id: `j:${j.rightDeId}:h`,
        source: j.leftDeId,
        target: j.rightDeId,
        sourceHandle: headerHandle(ls),
        targetHandle: headerHandle(rs),
        type: 'join',
        data: { ...base, label: true, missing: !j.rawOn, raw: !!j.rawOn },
      })
    }
  }
  return edges
}

/** Positions for every card with dagre, left to right along the joins. */
export function autoLayout(selectedDEs = [], joins = [], heights = {}) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 110, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const d of selectedDEs) g.setNode(d.id, { width: CARD_W, height: heights[d.id] || cardHeight(Math.min(FOLD_AT, d.fields?.length || 1)) })
  const ids = new Set(selectedDEs.map((d) => d.id))
  for (const j of joins) if (ids.has(j.leftDeId) && ids.has(j.rightDeId)) g.setEdge(j.leftDeId, j.rightDeId)
  dagre.layout(g)
  const out = {}
  for (const d of selectedDEs) {
    const n = g.node(d.id)
    out[d.id] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) }
  }
  return out
}

/** A free spot for a new card: right of the rightmost card, level with the top one. */
export function nextPosition(layout = {}) {
  const pts = Object.values(layout)
  if (!pts.length) return { x: 40, y: 40 }
  const maxX = Math.max(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  return { x: maxX + CARD_W + 110, y: minY }
}

/** Short label for a card header: alias and name. */
export function cardTitle(de, index) {
  return { alias: aliasOf(de, index), name: de?.name || de?.id }
}
