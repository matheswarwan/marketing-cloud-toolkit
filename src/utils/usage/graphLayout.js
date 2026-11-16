// Where used map layout: dagre, left to right, so data always flows to the right;
// automations sit in a band above, each over the first step it runs. Gives each node a
// position and each edge its path and arrowhead, so the map and the picture download
// draw the same thing.
import * as dagre from '@dagrejs/dagre'

export const MAP_NODE_W = 220
export const MAP_NODE_H = 52
const MARGIN = 24
const BAND_GAP = 56 // between the band and the map below it
const BAND_ROW = MAP_NODE_H + 18
const BAND_SPACE = 16 // between two automations in one row
const LANE = 14 // between two loops back under the map

/**
 * @param map buildUsageMap() output
 * @returns {{ width, height, nodes: [{ ...node, x, y }], edges: [{ ...edge, path, arrow, labelX, labelY, back, vertical? }] }}
 *   x, y are the top-left corner.
 */
export function layoutUsageMap(map) {
  const inBand = (n) => n.band && !n.focus
  const band = map.nodes.filter(inBand)
  const flow = map.nodes.filter((n) => !inBand(n))
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 80, edgesep: 12, marginx: 0, marginy: 0, ranker: 'network-simplex' })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of flow) g.setNode(n.id, { width: MAP_NODE_W, height: MAP_NODE_H })
  // Only edges that run forward by level shape the layout, each as many columns long
  // as the levels apart; the others (loops back) are drawn but do not move anything.
  const level = new Map(map.nodes.map((n) => [n.id, n.level ?? 0]))
  const inFlow = new Set(flow.map((n) => n.id))
  for (const e of map.edges) {
    if (!inFlow.has(e.source) || !inFlow.has(e.target)) continue
    const gap = level.get(e.target) - level.get(e.source)
    if (gap > 0) g.setEdge(e.source, e.target, { minlen: gap }, e.id)
  }
  dagre.layout(g)

  const pos = new Map()
  for (const n of flow) {
    const p = g.node(n.id)
    pos.set(n.id, { x: Math.round(p.x - MAP_NODE_W / 2), y: Math.round(p.y - MAP_NODE_H / 2) })
  }

  // The band: each automation over the leftmost step it runs, in as few rows as fit.
  if (band.length) {
    const top = Math.min(...[...pos.values()].map((p) => p.y))
    const anchor = (id) => {
      const xs = map.edges.filter((e) => e.source === id && pos.has(e.target)).map((e) => pos.get(e.target).x)
      return xs.length ? Math.min(...xs) : 0
    }
    // Each row keeps the boxes placed in it; a box tries its anchor, then up to two
    // places left and one right, before a new row (live test, 2026-11-16: automations
    // of one column stacked four rows high).
    const STEP = MAP_NODE_W + BAND_SPACE
    const rows = []
    const free = (row, x) => row.every((o) => x + MAP_NODE_W + BAND_SPACE <= o || x >= o + STEP)
    for (const n of band.map((b) => ({ id: b.id, x: anchor(b.id) })).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
      let placed = null
      for (let r = 0; r <= rows.length && !placed; r++) {
        if (r === rows.length) rows.push([])
        for (const x of [n.x, n.x - STEP, n.x - 2 * STEP, n.x + STEP]) {
          if (free(rows[r], x)) { placed = { r, x }; break }
        }
      }
      rows[placed.r].push(placed.x)
      pos.set(n.id, { x: placed.x, y: top - BAND_GAP - MAP_NODE_H - placed.r * BAND_ROW })
    }
  }

  // Everything from MARGIN, MARGIN.
  const minX = Math.min(...[...pos.values()].map((p) => p.x))
  const minY = Math.min(...[...pos.values()].map((p) => p.y))
  for (const p of pos.values()) { p.x += MARGIN - minX; p.y += MARGIN - minY }
  const nodes = map.nodes.map((n) => ({ ...n, ...pos.get(n.id) }))
  const bandIds = new Set(band.map((n) => n.id))

  // Loops back run under everything, one lane each, so they never cut across boxes.
  let lane = 0
  const gutterLane = new Map() // target column x → lines already down its gap
  const bottom = Math.max(...nodes.map((n) => n.y + MAP_NODE_H)) + 24
  const edges = map.edges.map((e) => {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (bandIds.has(e.source)) {
      // Straight down when nothing is in the way, else down the gap beside the column
      // (live test, 2026-11-16: lines ran through the boxes above the step).
      const blocked = nodes.some((n) => !bandIds.has(n.id) && n.id !== e.target && n.x < b.x + MAP_NODE_W && n.x + MAP_NODE_W > b.x && n.y < b.y && n.y + MAP_NODE_H > a.y + MAP_NODE_H)
      if (!blocked) return { ...e, ...downPath(a, b) }
      const k = gutterLane.get(b.x) || 0
      gutterLane.set(b.x, k + 1)
      return { ...e, ...gutterPath(a, b, k) }
    }
    return { ...e, ...edgePath(a, b, isBack(a, b) ? bottom + LANE * lane++ : 0) }
  })
  return {
    width: Math.ceil(Math.max(...nodes.map((n) => n.x + MAP_NODE_W)) + MARGIN),
    height: Math.ceil((lane ? bottom + LANE * (lane - 1) : bottom - 24) + MARGIN),
    nodes,
    edges,
  }
}

const isBack = (a, b) => b.x <= a.x + MAP_NODE_W + 10
const rightArrow = (x, y) => `M${x - 7},${y - 4} L${x},${y} L${x - 7},${y + 4} z`
const downArrow = (x, y) => `M${x - 4},${y - 7} L${x},${y} L${x + 4},${y - 7} z`

/**
 * A bezier from the right middle of `a` to the left middle of `b`. When `b` is not to
 * the right (a loop back), the line leaves `a` to the right, drops to `under` (below
 * every box), runs back left and comes up into `b` from its left.
 */
export function edgePath(a, b, under = 0) {
  const x1 = a.x + MAP_NODE_W
  const y1 = a.y + MAP_NODE_H / 2
  const x2 = b.x
  const y2 = b.y + MAP_NODE_H / 2
  if (!isBack(a, b)) {
    const c = Math.max(40, (x2 - x1) / 2)
    return { path: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, arrow: rightArrow(x2, y2), labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2, back: false }
  }
  const yb = Math.max(under, y1 + 30, y2 + 30)
  const r = 28
  return {
    path: `M${x1},${y1} C${x1 + r},${y1} ${x1 + r},${yb} ${x1},${yb} L${x2},${yb} C${x2 - r},${yb} ${x2 - r},${y2} ${x2},${y2}`,
    arrow: rightArrow(x2, y2),
    labelX: (x1 + x2) / 2,
    labelY: yb,
    back: true,
  }
}

/**
 * From the bottom of an automation down the gap left of the step's column, then into the
 * upper part of the step's left side (data lines use the middle).
 */
export function gutterPath(a, b, lane = 0) {
  const x1 = a.x + MAP_NODE_W / 2
  const y1 = a.y + MAP_NODE_H
  const gx = b.x - 16 - 6 * (lane % 5) // lines down one gap side by side
  const y2 = b.y + 12
  const r = 12
  return {
    path: `M${x1},${y1} C${x1},${y1 + 20} ${gx},${y1 + 6} ${gx},${y1 + 28} L${gx},${y2 - r} Q${gx},${y2} ${gx + r},${y2} L${b.x},${y2}`,
    arrow: rightArrow(b.x, y2),
    labelX: gx,
    labelY: y2 - 22,
    back: false,
    vertical: true,
  }
}

/** From the bottom middle of an automation in the band down to the top middle of a step. */
export function downPath(a, b) {
  const x1 = a.x + MAP_NODE_W / 2
  const y1 = a.y + MAP_NODE_H
  const x2 = b.x + MAP_NODE_W / 2
  const y2 = b.y
  const c = Math.max(30, (y2 - y1) / 2)
  return { path: `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`, arrow: downArrow(x2, y2), labelX: x2, labelY: y2 - 14, back: false, vertical: true }
}
