// Contacts > Data model (user, 2026-11-10): Contact Builder's Data Designer, read only.
// Attribute groups, the attribute sets (data extensions) in each and how they link.
// - Schema: GET contacts/v1/schema (checked live on s10).
// - Attribute sets: GET contacts/v1/attributeSetDefinitions, 50 a page (checked live: 30
//   on s10, each with relationships whose left/right items name an AttributeGroup or an
//   AttributeSet by identifier, with a cardinality One or Many).
// - Attribute groups: contacts/v1/attributeGroups, else Contact Builder's own
//   contacts-internal linkItems default view (neither shape checked live); when both fail,
//   the groups are the AttributeGroup identifiers the relationships name.
// Which fields link two sets (relationshipAttributes or similar) is read defensively: the
// field names are guesses. All REST through the Journey Builder host's /fuelapi.
import * as dagre from '@dagrejs/dagre'
import { sfmcFetch, searchDEsAllSources } from './sfmcApi.js'
import { htmlEscape } from './exportDoc.js'

const API = (stack) => `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/contacts/v1`
const CM = (stack) => `https://mc.${stack}.marketingcloudapps.com/contactsmeta/fuelapi`
const PAGE = 50
const MAX_PAGES = 20 // 1,000 attribute sets

/** Text of a value that SFMC gives as a string or as { value } (localized names). */
export function textOf(v) {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') return textOf(v.value ?? v.name ?? v.text ?? '')
  return ''
}
const idOf = (v) => String(v ?? '').toLowerCase()

export const fetchSchema = (stack, fetch = sfmcFetch) => fetch(`${API(stack)}/schema`, 'GET').then((d) => d?.item || d || {})

/** Every attribute set definition (pages of 50, polite: one page at a time). */
export async function fetchAttributeSets(stack, fetch = sfmcFetch) {
  const out = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await fetch(`${API(stack)}/attributeSetDefinitions?$page=${page}&$pagesize=${PAGE}`, 'GET')
    const items = d?.items || []
    out.push(...items)
    if (items.length < PAGE || out.length >= Number(d?.count || 0)) break
  }
  return out
}

/** Attribute groups from the first source that answers with a list; [] when none does. */
export async function fetchAttributeGroups(stack, fetch = sfmcFetch) {
  const sources = [
    `${API(stack)}/attributeGroups?$page=1&$pagesize=${PAGE}`,
    `${CM(stack)}/contacts-internal/v1/attributeGroups/linkItems/views/defaultView`,
  ]
  for (const url of sources) {
    try {
      const d = await fetch(url, 'GET')
      const list = listIn(d)
      if (list.length) return { groups: list.map(toGroup).filter((g) => g.id), source: url }
    } catch { /* try the next source */ }
  }
  return { groups: [], source: null }
}
function listIn(d) {
  if (Array.isArray(d)) return d
  for (const k of ['items', 'attributeGroups', 'groups', 'linkItems', 'entry']) if (Array.isArray(d?.[k])) return d[k]
  return []
}
export function toGroup(g) {
  return {
    id: String(g?.id ?? g?.definitionID ?? g?.attributeGroupID ?? g?.identifier ?? ''),
    key: textOf(g?.key ?? g?.definitionKey ?? ''),
    name: textOf(g?.name ?? g?.definitionName ?? g?.displayName ?? ''),
    description: textOf(g?.description ?? ''),
  }
}

// ── Mapping ──────────────────────────────────────────────
/** Field names of a set by attribute id (attributes / valueDefinitions, shapes vary). */
function attributeNames(set) {
  const m = new Map()
  for (const a of [...(set?.attributes || []), ...(set?.valueDefinitions || [])]) {
    const id = a?.id ?? a?.definitionID ?? a?.valueDefinitionID
    if (id != null) m.set(idOf(id), textOf(a.name ?? a.definitionName ?? a.key ?? a.fullyQualifiedName))
  }
  return m
}

/**
 * One attribute (field) of a set: shape checked live on s10, 2026-11-17 (attributes[]
 * with name { value }, storageName (the data extension column), dataType, length,
 * isPrimaryKey, isNullable, displayOrder, isHidden).
 */
export function toField(a) {
  return {
    id: String(a?.id ?? a?.definitionID ?? a?.valueDefinitionID ?? ''),
    name: textOf(a?.name ?? a?.definitionName ?? a?.key),
    column: textOf(a?.storageName ?? a?.key ?? '') || textOf(a?.name ?? a?.key),
    type: textOf(a?.dataType ?? ''),
    length: a?.length > 0 ? Number(a.length) : null,
    pk: !!a?.isPrimaryKey,
    nullable: a?.isNullable !== false,
    hidden: !!a?.isHidden,
    order: Number(a?.displayOrder ?? 0),
  }
}

export function toAttributeSet(s) {
  const fields = [...(s?.attributes || []), ...(s?.valueDefinitions || [])]
  return {
    id: String(s?.id ?? s?.definitionID ?? ''),
    key: textOf(s?.key ?? s?.definitionKey ?? ''),
    name: textOf(s?.name ?? s?.definitionName) || textOf(s?.fullyQualifiedName),
    fullyQualifiedName: textOf(s?.fullyQualifiedName),
    storage: textOf(s?.storageLogicalType),
    storageName: textOf(s?.storageName ?? s?.storageReferenceName ?? s?.dataExtensionName ?? ''),
    root: !!s?.isRoot,
    sendable: !!s?.isSendable,
    shared: !!s?.isShared,
    event: !!s?.isEvent,
    categoryId: s?.categoryID ?? null,
    fieldCount: fields.length || null,
    fields: fields.map(toField).filter((f) => f.id || f.name).sort((a, b) => (b.pk - a.pk) || (a.order - b.order)),
  }
}

/** The link fields of a relationship, as "left = right" pairs (field names guessed). */
function linkFields(r, names) {
  const list = r?.relationshipAttributes || r?.attributes || r?.relationshipAttributePairs || []
  const name = (id, n) => textOf(n) || names.get(idOf(id)) || ''
  return (Array.isArray(list) ? list : []).map((p) => {
    const left = name(p?.leftAttributeID ?? p?.leftItem?.identifier, p?.leftAttributeName ?? p?.leftItem?.name ?? p?.leftAttribute?.name)
    const right = name(p?.rightAttributeID ?? p?.rightItem?.identifier, p?.rightAttributeName ?? p?.rightItem?.name ?? p?.rightAttribute?.name)
    const leftId = idOf(p?.leftAttributeID ?? p?.leftItem?.identifier)
    const rightId = idOf(p?.rightAttributeID ?? p?.rightItem?.identifier)
    return left || right ? { left, right, leftId, rightId } : null
  }).filter(Boolean)
}

export function cardinalityText(left, right) {
  const one = (c) => String(c || '').toLowerCase() !== 'many'
  if (!left && !right) return ''
  return `${one(left) ? 'one' : 'many'}-to-${one(right) ? 'one' : 'many'}`
}

/**
 * Relationships of every set, once each (SFMC lists a link on both sets): { id, left:
 * { kind: 'group'|'set', id, cardinality }, right: {...}, fields: [{ left, right }] }.
 */
export function mapRelationships(rawSets) {
  const names = new Map()
  for (const s of rawSets) for (const [k, v] of attributeNames(s)) names.set(k, v)
  const seen = new Set()
  const out = []
  for (const s of rawSets) {
    for (const r of s?.relationships || []) {
      const side = (it) => (it ? {
        kind: String(it.relationshipType || '').toLowerCase() === 'attributegroup' ? 'group' : 'set',
        id: String(it.identifier ?? ''),
        cardinality: it.cardinality || '',
      } : null)
      const left = side(r?.leftItem)
      const right = side(r?.rightItem)
      if (!left?.id || !right?.id) continue
      const id = String(r?.id ?? r?.relationshipID ?? `${left.id}|${right.id}`)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, left, right, fields: linkFields(r, names) })
    }
  }
  return out
}

/**
 * The whole model: groups (with their sets, reached from the group through the links)
 * and the sets that no group reaches. `groups` from fetchAttributeGroups may be empty;
 * group ids named in the links are added with a plain name.
 */
export function buildModel(rawSets, rawGroups = []) {
  const sets = rawSets.map(toAttributeSet).filter((s) => s.id)
  const setById = new Map(sets.map((s) => [idOf(s.id), s]))
  const relationships = mapRelationships(rawSets)
  const groups = new Map(rawGroups.filter((g) => g.id).map((g) => [idOf(g.id), { ...g, sets: [], links: [] }]))
  for (const r of relationships) for (const it of [r.left, r.right]) {
    if (it.kind === 'group' && !groups.has(idOf(it.id))) groups.set(idOf(it.id), { id: it.id, key: '', name: '', description: '', sets: [], links: [] })
  }
  const nameOf = (it) => (it.kind === 'group' ? (groups.get(idOf(it.id))?.name || 'Contact') : (setById.get(idOf(it.id))?.name || it.id))
  const adjacency = new Map()
  const add = (a, r) => { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a).push(r) }
  for (const r of relationships) { add(idOf(r.left.id), r); add(idOf(r.right.id), r) }

  const placed = new Set()
  for (const g of groups.values()) {
    if (!g.name) g.name = g.key || `Attribute group ${g.id}`
    const queue = [idOf(g.id)]
    const reached = new Set(queue)
    while (queue.length) {
      const at = queue.shift()
      for (const r of adjacency.get(at) || []) {
        if (!g.links.includes(r)) g.links.push(r)
        for (const it of [r.left, r.right]) {
          const k = idOf(it.id)
          if (it.kind === 'set' && !reached.has(k) && setById.has(k)) { reached.add(k); queue.push(k); g.sets.push(setById.get(k)); placed.add(k) }
        }
      }
    }
  }
  const describe = (r) => ({ ...r, leftName: nameOf(r.left), rightName: nameOf(r.right), cardinality: cardinalityText(r.left.cardinality, r.right.cardinality) })
  const list = [...groups.values()].map((g) => ({
    ...g, links: g.links.map(describe), // Visible attributes, as Data Designer counts them (System Data on s10: 4 of 7, 2026-11-17).
    attributeCount: g.sets.reduce((n, s) => n + s.fields.filter((f) => !f.hidden).length, 0),
  })).sort((a, b) => a.name.localeCompare(b.name))
  const unplaced = sets.filter((s) => !placed.has(idOf(s.id))).sort((a, b) => a.name.localeCompare(b.name))
  return { groups: list, unplaced, sets, relationships: relationships.map(describe) }
}

/** What a set links to, in words: "Linked to Contact on Contact Key = SubscriberKey, one-to-many". */
export function linksOfSet(set, links) {
  const k = idOf(set.id)
  return links.filter((r) => idOf(r.left.id) === k || idOf(r.right.id) === k).map((r) => {
    const mineLeft = idOf(r.left.id) === k
    const other = mineLeft ? r.rightName : r.leftName
    const fields = r.fields.map((f) => (mineLeft ? `${f.left || '?'} = ${f.right || '?'}` : `${f.right || '?'} = ${f.left || '?'}`)).join(', ')
    const card = mineLeft ? r.cardinality : cardinalityText(r.right.cardinality, r.left.cardinality)
    return `Linked to ${other}${fields ? ` on ${fields}` : ''}${card ? `, ${card}` : ''}`
  })
}

// ── Diagram ──────────────────────────────────────────────
const NODE_W = 200
const NODE_H = 46

/** A group as boxes and arrows, laid out by dagre: { width, height, nodes, edges }. */
export function layoutGroup(group) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  const nodes = [{ id: idOf(group.id), label: group.name, sub: 'Attribute group', kind: 'group' }]
  for (const s of group.sets) nodes.push({ id: idOf(s.id), label: s.name, sub: [s.root && 'Root', s.sendable && 'Sendable', s.storage].filter(Boolean).join(' · '), kind: 'set' })
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  const edges = []
  for (const r of group.links) {
    const a = idOf(r.left.id)
    const b = idOf(r.right.id)
    if (!ids.has(a) || !ids.has(b) || a === b) continue
    g.setEdge(a, b)
    edges.push({ from: a, to: b, label: r.cardinality })
  }
  dagre.layout(g)
  const pos = new Map(nodes.map((n) => [n.id, g.node(n.id)]))
  const graph = g.graph()
  return {
    width: Math.ceil(graph.width || NODE_W + 32),
    height: Math.ceil(graph.height || NODE_H + 32),
    nodes: nodes.map((n) => ({ ...n, x: pos.get(n.id).x - NODE_W / 2, y: pos.get(n.id).y - NODE_H / 2, w: NODE_W, h: NODE_H })),
    edges: edges.map((e) => ({ ...e, a: pos.get(e.from), b: pos.get(e.to) })),
  }
}

const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/** SVG of a group (all values escaped), for the page and the HTML/PDF downloads. */
export function groupSvg(group) {
  const l = layoutGroup(group)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" font-family="system-ui, sans-serif" font-size="12">`,
    '<defs><marker id="dm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>']
  for (const e of l.edges) {
    const x1 = e.a.x + NODE_W / 2
    const x2 = e.b.x - NODE_W / 2
    const forward = x2 > x1
    const [sx, ex] = forward ? [x1, x2] : [e.a.x, e.b.x]
    const [sy, ey] = forward ? [e.a.y, e.b.y] : [e.a.y + NODE_H / 2, e.b.y - NODE_H / 2]
    parts.push(`<path d="M${sx},${sy} C${(sx + ex) / 2},${sy} ${(sx + ex) / 2},${ey} ${ex},${ey}" fill="none" stroke="#64748b" stroke-width="1.3" marker-end="url(#dm-arrow)"/>`)
    if (e.label) parts.push(`<text x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 5}" text-anchor="middle" fill="#475569" font-size="10">${htmlEscape(e.label)}</text>`)
  }
  for (const n of l.nodes) {
    const group = n.kind === 'group'
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${group ? '#ccfbf1' : '#ffffff'}" stroke="${group ? '#0f766e' : '#94a3b8'}" stroke-width="1.2"/>`)
    parts.push(`<text x="${n.x + 10}" y="${n.y + 19}" fill="#0f172a" font-weight="600">${htmlEscape(cut(n.label, 28))}</text>`)
    if (n.sub) parts.push(`<text x="${n.x + 10}" y="${n.y + 35}" fill="#64748b" font-size="10">${htmlEscape(cut(n.sub, 34))}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

/** Everything the page shows, read politely (schema, groups, then the sets page by page). */
export async function fetchDataModel(stack, fetch = sfmcFetch) {
  const schema = await fetchSchema(stack, fetch)
  const { groups, source } = await fetchAttributeGroups(stack, fetch)
  const rawSets = await fetchAttributeSets(stack, fetch)
  return { schema, groupSource: source, ...buildModel(rawSets, groups) }
}

/**
 * The data extension behind an attribute set, for Preview data, Run Query and Where used:
 * { id, customerKey, name, sourceType } or null. Matched by key, else by exact name (a
 * set's key and name are its data extension's, checked live on s10, 2026-11-17).
 * SFMC's own sets (MobileConnect, MobilePush, Predictive Intelligence) have none.
 */
export async function findSetDataExtension(stack, set, search = searchDEsAllSources) {
  if (!set?.name) return null
  const items = (await search(stack, set.name, 25))?.items || []
  const low = (v) => String(v ?? '').toLowerCase()
  const key = (d) => d.customerKey ?? d.key
  const de = (set.key && items.find((d) => low(key(d)) === low(set.key))) || items.find((d) => low(d.name) === low(set.name))
  if (!de) return null
  const sourceType = de.sourceType === 'shared' ? 'shared' : de.sourceType === 'sync' ? 'synchronized' : null
  return { id: String(de.id ?? ''), customerKey: String(key(de) ?? ''), name: String(de.name ?? ''), sourceType }
}

/** A data extension's name as SQL reaches it: a Shared one through ENT. (as deSql.js, feedback #73). */
export const deSqlName = (de) => (de.sourceType === 'shared' ? `ENT.${de.name}` : de.name)
