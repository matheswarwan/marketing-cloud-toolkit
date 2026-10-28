// Open in Diagramforce (diagramforce.com, Mateusz Dabrowski's free diagram editor).
// Diagramforce imports a diagram JSON sent over postMessage to a tab opened at
// #import=postmessage (its documented web integration); this file builds that JSON to
// the published spec (DIAGRAM_JSON_SPEC.md, appVersion 1.26.4) from the Query Builder model:
//   'model'   data model: a card per table (fields used, or all), joins as field lines
//   'lineage' data mapping: source tables on the left, the query output on the right,
//             each output column linked from the fields it reads
import { aliasOf, selectListItems } from './sqlBuilder.js'
import { joinedFields } from './builderCanvas.js'

export const DIAGRAMFORCE_ORIGIN = 'https://diagramforce.com'
const APP_VERSION = '1.26.4'
const COLORS = { de: '#1D73C9', dataview: '#B652A7', shared: '#0B827C', output: '#2E844A', missing: '#74797F' }
const ROW = 22
const heightFor = (n) => 32 + Math.max(n, 1) * ROW + 18
const TYPE_NAMES = { 0: 'Text', 1: 'Number', 2: 'Date', 3: 'Boolean', 4: 'EmailAddress', 5: 'Phone', 6: 'Decimal', 7: 'Locale' }

function typeName(f) {
  const t = f?.type ?? f?.fieldType
  if (typeof t === 'number') return TYPE_NAMES[t] || 'Text'
  return t ? String(t) : 'Text'
}
const isKey = (f) => !!(f?.isPrimaryKey || f?.isKey || f?.primaryKey)
const cardColor = (de) => (de.missing ? COLORS.missing : de.isDataView || de.sourceType === 'dataview' ? COLORS.dataview : de.sourceType === 'shared' || de.sourceType === 'sync' ? COLORS.shared : COLORS.de)

function link(id, source, target, extra = {}) {
  return {
    id, type: 'standard.Link', z: 3001, source, target,
    router: { name: 'sfManhattan' }, connector: { name: 'rounded', args: { radius: 8 } },
    attrs: { line: { stroke: '#74797F', strokeWidth: 2, targetMarker: { type: 'path', d: 'M 0 0 L -12 0', fill: 'none', stroke: '#74797F', 'stroke-width': 2 } } },
    ...extra,
  }
}

/** Field names a table contributes: joined, output, filtered (or every field with `allFields`). */
function usedFields(de, index, joined, where, queryOptions) {
  const out = new Set(joined.get(de.id) || [])
  const all = (de.fields || []).map((f) => f.name)
  const ticked = de.selectedFields === null ? all : de.selectedFields || []
  ticked.forEach((n) => out.add(n))
  const alias = aliasOf(de, index).toLowerCase()
  const walk = (g) => (g?.conditions || []).forEach((c) => (c.conditions ? walk(c) : String(c.alias || '').toLowerCase() === alias && c.field && out.add(c.field)))
  walk(where)
  for (const g of [...(queryOptions?.groupBy || []), ...(queryOptions?.orderBy || [])]) if (String(g.alias || '').toLowerCase() === alias && g.field) out.add(g.field)
  return all.filter((n) => out.has(n))
}

/**
 * Builds the Diagramforce diagram for the builder state.
 * @param {{ selectedDEs, joins, where, queryOptions, layout }} state
 * @param {{ mode?: 'model'|'lineage', allFields?: boolean, title?: string }} opts
 */
export function builderToDiagramforce(state, { mode = 'model', allFields = false, title = 'Query' } = {}) {
  const { selectedDEs = [], joins = [], where = null, queryOptions = {}, layout = {} } = state
  const joined = joinedFields(selectedDEs, joins)
  const cells = []
  const fidOf = new Map() // `${deId}|${field}` -> fid
  const W = 300
  const lineage = mode === 'lineage'
  selectedDEs.forEach((de, i) => {
    const names = allFields ? (de.fields || []).map((f) => f.name) : usedFields(de, i, joined, where, queryOptions)
    const byName = new Map((de.fields || []).map((f) => [f.name, f]))
    const fields = names.map((name, k) => {
      const f = byName.get(name) || { name }
      const fid = `t${i}f${k}`
      fidOf.set(`${de.id}|${name}`, fid)
      return { label: name, apiName: name, type: typeName(f), keyType: isKey(f) ? 'pk' : null, length: f.length ?? f.maxLength ?? null, required: !!(f.isRequired || isKey(f)), deprecated: false, fid }
    })
    // Lineage: sources in one column; model: the builder's own layout, spread out.
    const p = lineage ? { x: 80, y: 80 + selectedDEs.slice(0, i).reduce((h, d, k) => h + heightFor(fieldCountFor(k)) + 60, 0) } : {
      x: Math.round((layout[de.id]?.x ?? i * 360) * 1.35) + 80,
      y: Math.round((layout[de.id]?.y ?? 0) * 1.2) + 80,
    }
    cells.push({
      id: `tbl-${i}`, type: 'sf.DataObject', position: p, size: { width: W, height: heightFor(fields.length) }, z: 2000,
      objectName: `${de.name} (${aliasOf(de, i)})`, headerColor: cardColor(de), fields,
      showLabels: false, showFieldLengths: false, keyFieldsOnly: false,
    })
  })
  function fieldCountFor(k) {
    const d = selectedDEs[k]
    return allFields ? (d.fields || []).length : usedFields(d, k, joined, where, queryOptions).length
  }
  const tableId = new Map(selectedDEs.map((d, i) => [d.id, `tbl-${i}`]))

  // Joins: one line per condition between the two fields, labelled with the join type.
  joins.forEach((j, ji) => {
    const conds = j.rawOn ? [] : (j.conditions || []).filter((c) => c.leftField && c.rightField)
    if (!conds.length) {
      if (tableId.has(j.leftDeId) && tableId.has(j.rightDeId)) {
        cells.push(link(`join-${ji}`, { id: tableId.get(j.leftDeId), port: 'er-right' }, { id: tableId.get(j.rightDeId), port: 'er-left' }, {
          labels: [{ position: 0.5, attrs: { text: { text: `${j.joinType || 'JOIN'}${j.rawOn && j.onClause ? ' ON ' + j.onClause : ''}` } } }],
          ...(lineage ? { lineStyle: '8 4' } : {}),
        }))
      }
      return
    }
    conds.forEach((c, ci) => {
      const left = c.leftDeId || j.leftDeId
      const lf = fidOf.get(`${left}|${c.leftField}`)
      const rf = fidOf.get(`${j.rightDeId}|${c.rightField}`)
      if (!lf || !rf || !tableId.has(left)) return
      cells.push(link(`join-${ji}-${ci}`, { id: tableId.get(left), port: `field-right-${lf}` }, { id: tableId.get(j.rightDeId), port: `field-left-${rf}` }, {
        labels: ci ? [] : [{ position: 0.5, attrs: { text: { text: `${j.joinType || 'INNER JOIN'}${(c.operator || '=') !== '=' ? ' ' + c.operator : ''}` } } }],
        ...(lineage ? { lineStyle: '8 4' } : {}),
      }))
    })
  })

  if (lineage) {
    const items = selectListItems(selectedDEs, queryOptions).filter((it) => !it.key.startsWith('s:'))
    const outFields = items.map((it, k) => ({ label: it.name, apiName: it.name, type: 'Text', keyType: null, length: null, required: false, deprecated: false, fid: `o${k}` }))
    cells.push({
      id: 'output', type: 'sf.DataObject', position: { x: 80 + W + 360, y: 80 }, size: { width: W, height: heightFor(outFields.length) }, z: 2000,
      objectName: 'Query output', headerColor: COLORS.output, fields: outFields, showLabels: false, showFieldLengths: false, keyFieldsOnly: false,
    })
    const aliasToDe = new Map(selectedDEs.map((d, i) => [aliasOf(d, i).toLowerCase(), d]))
    items.forEach((it, k) => {
      const sources = []
      if (it.key.startsWith('c:')) {
        const [, deId, ...rest] = it.key.split(':')
        sources.push({ deId, field: rest.join(':') })
      } else {
        // Columns an expression reads: alias.[Field] or alias.Field
        const re = /([A-Za-z_][\w]*|\[[^\]]+\])\s*\.\s*(\[[^\]]+\]|[A-Za-z_][\w]*)/g
        let m
        const expr = it.sql.replace(/\s+AS\s+\[[^\]]*\]$/i, '')
        while ((m = re.exec(expr))) {
          const de = aliasToDe.get(m[1].replace(/^\[|\]$/g, '').toLowerCase())
          const field = m[2].replace(/^\[|\]$/g, '')
          const real = de && (de.fields || []).find((f) => f.name.toLowerCase() === field.toLowerCase())?.name
          if (de && real) sources.push({ deId: de.id, field: real, expr })
        }
      }
      sources.forEach((s, si) => {
        const fid = fidOf.get(`${s.deId}|${s.field}`)
        if (!fid) return
        cells.push({
          id: `map-${k}-${si}`, type: 'standard.Link', z: 3001, linkKind: 'mapping',
          source: { id: tableId.get(s.deId), port: `field-right-${fid}` }, target: { id: 'output', port: `field-left-o${k}` },
          ...(s.expr ? { mappingType: 'Formula', expressionRule: s.expr } : { mappingType: 'Standard' }),
          attrs: { line: { stroke: '#A06F03', strokeWidth: 1 } },
        })
      })
    })
  }

  return { version: 1, appVersion: APP_VERSION, timestamp: Date.now(), title, diagramType: lineage ? 'datamapping' : 'datamodel', graph: { cells } }
}

/**
 * Opens Diagramforce in a new tab and sends it the diagram once it says it is ready.
 * Must be called from a click. `diagram` may be a promise (the tab opens at once, so
 * the browser does not block it). Returns false when the pop-up was blocked.
 */
export function openInDiagramforce(diagram) {
  const win = window.open(`${DIAGRAMFORCE_ORIGIN}/#import=postmessage`, '_blank')
  if (!win) return false
  let done = false
  async function onMessage(event) {
    if (event.origin !== DIAGRAMFORCE_ORIGIN || done) return
    const d = event.data
    if (!d || d.source !== 'diagramforce' || d.type !== 'ready') return
    done = true
    window.removeEventListener('message', onMessage)
    const json = JSON.stringify(await diagram)
    win.postMessage({ source: 'diagramforce', type: 'import', v: 1, json }, DIAGRAMFORCE_ORIGIN)
  }
  window.addEventListener('message', onMessage)
  setTimeout(() => window.removeEventListener('message', onMessage), 60000)
  return true
}
