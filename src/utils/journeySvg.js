// Where each journey step and arrow goes on the canvas (JourneyCanvas.vue), and the same
// drawing as a standalone SVG for the HTML and PDF downloads (feedback #1009).
import { nodeKind, nodeSummary, nodeTypeLabel } from './journeys.js'
import { htmlEscape } from './exportDoc.js'

export const NODE_W = 184
export const NODE_H = 76
export const EXIT_H = 40
const GAP_FLOW = 72 // between steps along the flow
const GAP_LANE = 36 // between paths

/** `{ size: { w, h }, nodes: [{ ...node, box, kind, summary }], edges: [{ id, d, label, lx, ly }] }` */
export function journeyGeometry(graph, layout, orientation = 'horizontal') {
  const horizontal = orientation !== 'vertical'
  const cell = horizontal ? { w: NODE_W + GAP_FLOW, h: NODE_H + GAP_LANE } : { w: NODE_W + GAP_LANE, h: NODE_H + GAP_FLOW }
  const box = (key) => {
    const p = layout.pos.get(key)
    if (!p) return null
    const [col, row] = horizontal ? [p.depth, p.lane] : [p.lane, p.depth]
    return { x: 16 + col * cell.w, y: 16 + row * cell.h }
  }
  const [cols, rows] = horizontal ? [layout.depths, layout.lanes] : [layout.lanes, layout.depths]
  const size = { w: 32 + cols * cell.w - (horizontal ? GAP_FLOW : GAP_LANE), h: 32 + rows * cell.h - (horizontal ? GAP_LANE : GAP_FLOW) }
  const nodes = graph.nodes.map((n) => ({ ...n, box: box(n.key), kind: nodeKind(n.type), summary: nodeSummary(n) })).filter((n) => n.box)
  // Elbow from the parent's exit side to the child's entry side.
  const edges = graph.edges.map((e, i) => {
    const a = box(e.from)
    const b = box(e.to)
    if (!a || !b) return null
    let d, lx, ly
    if (horizontal) {
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2
      const mx = x2 > x1 ? x1 + (x2 - x1) / 2 : x1 + GAP_FLOW / 2
      d = `M${x1},${y1} H${mx} V${y2} H${x2}`
      lx = mx + 4; ly = y2 - 4
    } else {
      const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y
      const my = y2 > y1 ? y1 + (y2 - y1) / 2 : y1 + GAP_FLOW / 2
      d = `M${x1},${y1} V${my} H${x2} V${y2}`
      lx = x2 + 4; ly = my - 4
    }
    return { id: i, d, label: e.label, lx, ly }
  }).filter(Boolean)
  return { size, nodes, edges }
}

const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t }

// Light colours of the canvas kinds: border, fill, tag text.
const COLORS = {
  entry: ['#34d399', '#ecfdf5', '#047857'],
  message: ['#38bdf8', '#f0f9ff', '#0369a1'],
  wait: ['#fbbf24', '#fffbeb', '#b45309'],
  split: ['#a78bfa', '#f5f3ff', '#6d28d9'],
  action: ['#94a3b8', '#f8fafc', '#334155'],
  exit: ['#cbd5e1', '#f1f5f9', '#64748b'],
}

/** The journey as an SVG string: the canvas as Journey Builder draws it, without icons. */
export function journeySvg(graph, layout, orientation = 'horizontal') {
  const { size, nodes, edges } = journeyGeometry(graph, layout, orientation)
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}" font-family="'Segoe UI',Arial,sans-serif" role="img" aria-label="Journey diagram">`,
    '<defs><marker id="jarrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker></defs>']
  for (const e of edges) {
    out.push(`<path d="${e.d}" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#jarrow)"/>`)
    if (e.label) out.push(`<text x="${e.lx}" y="${e.ly}" font-size="10" fill="#1a1a1a">${htmlEscape(cut(e.label, 28))}</text>`)
  }
  for (const n of nodes) {
    const [stroke, fill, tag] = COLORS[n.kind] || COLORS.action
    const { x, y } = n.box
    const exit = n.kind === 'exit'
    const type = n.kind === 'entry' ? 'Entry' : exit ? 'Exit' : nodeTypeLabel(n.type)
    out.push(`<g><title>${htmlEscape(n.name || type)}</title>`,
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${exit ? EXIT_H : NODE_H}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"${exit ? ' stroke-dasharray="5 3"' : ''}/>`,
      `<text x="${x + 10}" y="${y + 17}" font-size="10" font-weight="600" fill="${tag}" letter-spacing="0.5">${htmlEscape(cut(String(type).toUpperCase(), 28))}</text>`)
    if (!exit) out.push(`<text x="${x + 10}" y="${y + 35}" font-size="12" font-weight="500" fill="#1a1a1a">${htmlEscape(cut(n.name, 26))}</text>`)
    if (!exit && n.summary) out.push(`<text x="${x + 10}" y="${y + 52}" font-size="10" fill="#64748b">${htmlEscape(cut(n.summary, 32))}</text>`)
    out.push('</g>')
  }
  out.push('</svg>')
  return out.join('')
}
