// Where used map as a standalone SVG (light colours, fonts from the system), for the
// picture download and the HTML and PDF downloads. Built from layoutUsageMap(), so it
// matches the map on screen. Every value from SFMC is escaped.
import { MAP_NODE_W, MAP_NODE_H } from './graphLayout.js'
import { NODE_TYPES } from './graph.js'

// The map's light theme (UsageMap.vue), as hex for files opened anywhere.
export const SVG_COLORS = {
  de: '#157a87', dataview: '#55657f', field: '#157a87', query: '#2563eb', filter: '#6b7280', import: '#c96a04', extract: '#5a8a0f',
  transfer: '#c96a04', file: '#78716c', location: '#78716c', script: '#7c3aed', send: '#db2777', event: '#ea580c', journey: '#15803d',
  content: '#0284c7', automation: '#b45309', step: '#475569', profile: '#475569', more: '#64748b',
}
const EDGE = { reads: '#0e8ac7', writes: '#d97706', uses: '#8b5cf6', entry: '#15803d', sends: '#db2777', runs: '#94a3b8', file: '#78716c' }
const STATE = { paused: '#d97706', error: '#dc2626' }
const PRIMARY = '#0176d3'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''))

/**
 * @param laid layoutUsageMap() output
 * @param o.title shown above the map
 * @returns {string} an <svg> document
 */
export function usageMapSvg(laid, { title = '' } = {}) {
  const head = title ? 28 : 0
  const w = laid.width
  const h = laid.height + head
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
  ]
  if (title) out.push(`<text x="24" y="22" font-size="14" font-weight="700" fill="#111827">${esc(title)}</text>`)
  out.push(`<g transform="translate(0 ${head})">`)
  for (const e of laid.edges) {
    const color = e.state ? STATE[e.state] : EDGE[e.rel] || '#94a3b8'
    const dash = e.possible ? ' stroke-dasharray="6 4"' : e.state ? ' stroke-dasharray="2 4"' : e.back ? ' stroke-dasharray="2 4"' : ''
    out.push(`<path d="${e.path}" fill="none" stroke="${color}" stroke-width="1.4"${dash}/>`)
    if (e.arrow) out.push(`<path d="${e.arrow}" fill="${color}"/>`)
  }
  // Text is clipped to the box: names such as %%FILENAME%% are wide in any font.
  out.push(`<defs><clipPath id="umap-text"><rect x="48" y="0" width="${MAP_NODE_W - 56}" height="${MAP_NODE_H}"/></clipPath></defs>`)
  for (const n of laid.nodes) {
    const c = n.focus ? PRIMARY : SVG_COLORS[n.type] || SVG_COLORS.more
    const rx = n.type === 'de' || n.type === 'dataview' ? MAP_NODE_H / 2 : ['query', 'filter', 'import', 'extract', 'transfer', 'script', 'send', 'step'].includes(n.type) ? 4 : 10
    const dash = n.possible || n.ghost || n.type === 'more' ? ' stroke-dasharray="5 3"' : n.state === 'paused' ? ' stroke-dasharray="4 3"' : ''
    const stroke = n.state === 'error' ? STATE.error : n.state === 'paused' ? STATE.paused : c
    out.push(`<g transform="translate(${n.x} ${n.y})">`,
      `<rect width="${MAP_NODE_W}" height="${MAP_NODE_H}" rx="${rx}" fill="${n.focus ? '#eef6fd' : '#ffffff'}" stroke="${stroke}" stroke-width="${n.focus ? 2 : 1}"${dash}/>`,
      `<rect x="10" y="11" width="30" height="30" rx="${rx > 10 ? 15 : 8}" fill="${c}" fill-opacity="0.16"/>`,
      `<text x="25" y="30" font-size="10" font-weight="700" text-anchor="middle" fill="${c}">${esc(abbr(n.type))}</text>`,
      `<g clip-path="url(#umap-text)"><text x="50" y="23" font-size="12" font-weight="600" fill="${n.type === 'more' ? PRIMARY : '#111827'}">${esc(cut(n.label, 28))}</text>`,
      `<text x="50" y="38" font-size="10.5" fill="#6b7280">${esc(cut(n.sub, 36))}</text></g>`,
      '</g>')
  }
  out.push('</g></svg>')
  return out.join('')
}

const ABBR = { de: 'DE', dataview: 'DV', field: 'FD', query: 'SQL', filter: 'FL', import: 'IM', extract: 'EX', transfer: 'FT', file: 'F', location: 'LOC', script: 'JS', send: 'SE', event: 'EV', journey: 'JB', content: 'CB', automation: 'AU', step: 'ST', profile: 'PR', more: '…' }
const abbr = (t) => ABBR[t] || (NODE_TYPES[t]?.label || '?').slice(0, 2).toUpperCase()

/** The SVG as a PNG blob at `scale` (2 for sharp text), drawn by the browser. */
export function svgToPng(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(img.width * scale)
      canvas.height = Math.ceil(img.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => reject(new Error('The picture could not be made.'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
