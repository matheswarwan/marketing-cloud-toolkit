// Where used map (user, 2026-11-16): the scan's results as a flow chart around the
// thing that was checked. Idea from the VeLens extension's dependency map; this is our
// own model and code.
//
// Two parts, both pure:
//   - mapInput(): made once per scan (kinds.js) and kept in the result: the focus box,
//     the lineage edges in reach (data extensions only), the result items, and how each
//     item uses the focus (`uses`).
//   - buildUsageMap(): made on every view change (depth, an opened "+N more",
//     automations on or off): the nodes and edges to draw, each node with its level
//     relative to the focus (negative upstream) and a parent link back to the focus.
// The layout (positions and edge paths) is in graphLayout.js.
//
// Edges point the way data moves: a DE is read by a query, the query writes the next
// DE; a file is loaded by an import; an entry event starts a journey; an automation
// runs its steps (drawn from a band above the map).
import { norm } from './match.js'
import { DATA_VIEWS } from '../dataViews.js'
import { statusWords } from '../format.js'

/** Node types, in the order the key lists them. */
export const NODE_TYPES = {
  de: { label: 'Data extension' },
  dataview: { label: 'Data view' },
  field: { label: 'Field' },
  query: { label: 'SQL Query' },
  filter: { label: 'Filter' },
  import: { label: 'Import' },
  extract: { label: 'Data Extract' },
  transfer: { label: 'File Transfer' },
  file: { label: 'File' },
  location: { label: 'File location' },
  script: { label: 'Script' },
  send: { label: 'Send Email' },
  event: { label: 'Entry event' },
  journey: { label: 'Journey' },
  content: { label: 'Content' },
  automation: { label: 'Automation' },
  step: { label: 'Automation step' },
  profile: { label: 'Profile' },
  more: { label: 'More' },
}

/** Edge kinds. The label reads along the arrow: "Staging → read by → build". */
export const EDGE_KINDS = {
  reads: { label: 'read by', key: 'Read by (SQL, filter, extract, send audience)' },
  writes: { label: 'writes', key: 'Writes into' },
  uses: { label: 'named in', key: 'Named in code, criteria or content' },
  entry: { label: 'entry source', key: 'Entry source of a journey' },
  sends: { label: 'sent by', key: 'Sent by a journey or Send Email activity' },
  runs: { label: 'runs', key: 'Run by an automation (step)' },
  file: { label: 'file', key: 'File loaded or written' },
}

/** Edge states, drawn on top of the kind. */
export const EDGE_STATES = {
  possible: { key: 'Possible match (the name appears; check it)' },
  paused: { key: 'Automation paused or stopped' },
  error: { key: 'Automation in error' },
}

export const DEPTHS = [1, 2, 'all']
export const MAX_DEPTH = 6 // the lineage tree's limit, so "All" means the same as the list
const GROUP_AT = 6 // more than this many of one type next to one node are folded…
const KEEP = 4 // …into the first few and a "+N more" box

const VIA_TYPE = { query: 'query', filter: 'filter', import: 'import', extract: 'extract' }
const VIA_PREFIX = { query: 300, filter: 303, import: 43, extract: 73 }
const DE_SECTION_TYPE = { queries: 'query', filters: 'filter', imports: 'import', extracts: 'extract', scripts: 'script', sends: 'send', events: 'event', journeys: 'journey', content: 'content' }
const TYPE_BY_ACTIVITY = { 300: 'query', 303: 'filter', 43: 'import', 73: 'extract', 53: 'transfer', 423: 'script', 42: 'send' }

const DATA_VIEW_NAMES = new Set([...DATA_VIEWS].map(norm))
export const deNodeId = (name) => `de:${norm(name)}`
/** The result item key of a lineage activity (the same key activityItem() gives it). */
export const viaKey = (via) => `${VIA_PREFIX[via.kind]}:${via.id}`
/** The map type of an automation activity type ID (300 → query), or a fallback. */
export const activityMapType = (typeId, fallback = 'step') => TYPE_BY_ACTIVITY[Number(typeId)] || fallback

/** paused | error | '' for an automation status such as "Paused", "Error", "Scheduled". */
export function automationState(status) {
  const s = String(status ?? '')
  if (/error/i.test(s)) return 'error'
  if (/paus|stop|inactive/i.test(s)) return 'paused'
  return ''
}

/**
 * The lineage edges reachable from `name` up to `maxDepth` data extensions away,
 * upstream and downstream (each direction from the focus only, like the tree).
 */
export function reachableLineage(edges, name, maxDepth = MAX_DEPTH) {
  const keep = new Set()
  for (const dir of ['up', 'down']) {
    const byNode = indexEdges(edges, dir)
    let level = [norm(name)]
    const seen = new Set(level)
    for (let depth = 0; depth < maxDepth && level.length; depth++) {
      const next = []
      for (const n of level) {
        for (const e of byNode.get(n) || []) {
          keep.add(e)
          const other = norm(dir === 'up' ? e.from : e.to)
          if (other && !seen.has(other)) { seen.add(other); next.push(other) }
        }
      }
      level = next
    }
  }
  return edges.filter((e) => keep.has(e))
}

function indexEdges(edges, dir) {
  const byNode = new Map()
  for (const e of edges) {
    const k = norm(dir === 'up' ? e.to : e.from)
    if (!k) continue
    if (!byNode.has(k)) byNode.set(k, [])
    byNode.get(k).push(e)
  }
  return byNode
}

// ── Input ─────────────────────────────────────────────────

const possibleOf = (item) => (item.badges || []).some((b) => b.tone === 'maybe')

/**
 * One way a result item uses the focus. `dir` 'in' draws item → focus (it feeds the
 * focus), 'out' draws focus → item. `hub` hangs it off a hub box instead of the focus.
 */
export function useOf(item, type, dir, rel, extra = {}) {
  return { key: item.key, type, dir, rel, possible: possibleOf(item), ...extra }
}

/** How each item uses a data extension, from its section and badges ("Writes…" feeds it). */
export function deUses(sections) {
  const uses = []
  for (const s of sections) {
    const type = DE_SECTION_TYPE[s.id]
    if (!type) continue
    for (const i of s.items || []) {
      const tones = (i.badges || []).map((b) => b.tone)
      const writes = tones.includes('write')
      const reads = tones.includes('read')
      if (writes && !reads) uses.push(useOf(i, type, 'in', 'writes'))
      else if (type === 'event') uses.push(useOf(i, type, 'out', 'entry'))
      else uses.push(useOf(i, type, 'out', reads ? 'reads' : 'uses'))
    }
  }
  return uses
}

/** The focus box for a data extension or data view. */
export function deFocus(de) {
  const view = !!de.dataView || DATA_VIEW_NAMES.has(norm(de.name))
  return { id: deNodeId(de.name), type: view ? 'dataview' : 'de', label: de.name, sub: `${view ? 'Data view' : 'Data extension'} · checked`, deName: de.name }
}

/**
 * The map's input, kept in the scan result. Items are the result's own objects (not
 * copies), so the details pane shows them whole.
 * @param o.de a data extension (its focus, lineage and uses are worked out here), or
 * @param o.focus { id, type, label, sub, deName? } with o.uses (see useOf) for any other kind
 * @param o.hubs [{ id, type, label, sub }]: boxes between the focus and the items that name them in `hub`
 */
export function mapInput({ de, focus, edges = [], sections = [], extraItems = [], uses, hubs = [] }) {
  const items = {}
  for (const i of extraItems) items[i.key] = i
  for (const s of sections) for (const i of s.items || []) items[i.key] = i
  return {
    focus: de ? deFocus(de) : focus,
    edges: edges.map((e) => ({ from: e.from, to: e.to, ent: !!e.ent, via: { kind: e.via.kind, name: e.via.name, id: e.via.id, file: e.via.file || '' } })),
    uses: uses || (de ? deUses(sections) : []),
    hubs,
    items,
  }
}

// ── Nodes ─────────────────────────────────────────────────

const automationText = (autos) => {
  if (autos === undefined) return ''
  if (autos === null) return 'Automations not checked'
  if (!autos.length) return 'Not in any automation'
  if (autos.length === 1) return `${autos[0].name}, step ${autos[0].step}`
  return `In ${autos.length} automations`
}

function deNode(name, { ent = false, keyOnly = false } = {}) {
  const view = DATA_VIEW_NAMES.has(norm(name))
  const ghost = ent ? 'Shared data extension (ENT.), in the parent business unit' : keyOnly ? 'Known only by its key here' : ''
  return {
    id: deNodeId(name), type: view ? 'dataview' : 'de', label: name, deName: keyOnly ? '' : name,
    sub: ghost ? (ent ? 'Shared (ENT.)' : 'Known by key only') : view ? 'Data view' : 'Data extension',
    ghost,
  }
}

function itemNode(id, type, item, fallback) {
  const status = (item?.badges || []).find((b) => b.tone === 'status')?.text || item?.status || ''
  const sub = [item?.kind || NODE_TYPES[type].label, statusWords(status), item?.mapNote || '', automationText(item?.automations)].filter(Boolean).join(' · ')
  return { id, type, label: item?.title || fallback || NODE_TYPES[type].label, sub, item: item || null, state: type === 'automation' ? automationState(status) : '' }
}

/** The box for one use: a data extension or automation item shares the box of that thing. */
function useNode(u, item) {
  if (u.type === 'de' && item?.pivot?.de?.name) return { ...deNode(item.pivot.de.name, { ent: u.ent }), item }
  if (u.type === 'de') return { ...deNode(item?.title || u.key, { keyOnly: true }), item }
  if (u.type === 'automation' && item?.automationId) return { ...itemNode(`auto:${item.automationId}`, 'automation', item), band: true }
  return itemNode(`act:${u.key}`, u.type, item)
}

function plural(n, word) {
  const w = word.toLowerCase()
  return `${n.toLocaleString()} ${n === 1 ? w : w.endsWith('y') && !/[aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`
}

// ── The map ───────────────────────────────────────────────

/**
 * The nodes and edges to draw.
 * @param input mapInput() output
 * @param opts.depth 1 | 2 | 'all' (data extensions away from the focus; lineage only)
 * @param opts.expanded Set of "+N more" node ids the user opened
 * @param opts.automations draw the automations that run each activity (a band above)
 * @returns {{ nodes, edges, hidden: number }}
 *   nodes: { id, type, label, sub, focus?, deName?, item?, parent, level, band?, ghost?, state?, count?, possible? }
 *   edges: { id, source, target, rel, possible, state, label }
 */
export function buildUsageMap(input, { depth = 2, expanded = new Set(), automations = true } = {}) {
  const maxDepth = depth === 'all' ? MAX_DEPTH : Number(depth) || 1
  const nodes = new Map()
  const edges = new Map()
  let hidden = 0
  const focusId = input.focus.id
  nodes.set(focusId, { ...input.focus, focus: true, parent: null, level: 0 })
  const levelOf = (id) => nodes.get(id)?.level ?? 0

  // `level` is the node's column relative to the focus, from the first way it was
  // reached; the layout ranks by it, so a loop cannot pull the focus mid-chain.
  const addNode = (n, parent, level) => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, parent, level }); return nodes.get(n.id) }
  const addEdge = (source, target, rel, { possible = false, label = '', state = '' } = {}) => {
    const id = `${source}>${target}>${rel}`
    const prev = edges.get(id)
    if (prev) { prev.possible = prev.possible && possible; return prev }
    const e = { id, source, target, rel, possible, state, label: label || EDGE_KINDS[rel]?.label || '' }
    edges.set(id, e)
    return e
  }
  // Folds a long list of one type next to `at` into a "+N more" box, unless opened.
  const fold = (at, dir, list, typeOf, nameOf) => {
    const groups = new Map()
    for (const x of list) {
      const t = typeOf(x)
      if (!groups.has(t)) groups.set(t, [])
      groups.get(t).push(x)
    }
    const shown = []
    for (const [type, group] of groups) {
      const moreId = `more:${at}:${dir}:${type}`
      if (group.length <= GROUP_AT || expanded.has(moreId)) { shown.push(...group); continue }
      const sorted = [...group].sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b))))
      shown.push(...sorted.slice(0, KEEP))
      const rest = sorted.length - KEEP
      hidden += rest
      addNode({ id: moreId, type: 'more', label: `+${rest} more`, sub: plural(rest, NODE_TYPES[type]?.label || type), count: rest, moreType: type }, at, levelOf(at) + (dir === 'up' ? -1 : 1))
      if (dir === 'up') addEdge(moreId, at, 'writes')
      else addEdge(at, moreId, 'reads')
    }
    return shown
  }

  // Lineage (data extensions): breadth first from the focus, upstream and downstream
  // one level at a time each, so a node takes its level from the shortest way to it.
  if (input.focus.deName && input.edges.length) {
    const index = { up: indexEdges(input.edges, 'up'), down: indexEdges(input.edges, 'down') }
    const frontier = { up: [input.focus.deName], down: [input.focus.deName] }
    const seen = { up: new Set([norm(input.focus.deName)]), down: new Set([norm(input.focus.deName)]) }
    for (let d = 0; d < maxDepth; d++) {
      for (const dir of ['up', 'down']) {
        const next = []
        const step = dir === 'up' ? -1 : 1
        for (const name of frontier[dir]) {
          const at = deNodeId(name)
          const list = fold(at, dir, index[dir].get(norm(name)) || [], (e) => VIA_TYPE[e.via.kind], (e) => e.via.name)
          for (const e of list) {
            const key = viaKey(e.via)
            const vid = `act:${key}`
            addNode(itemNode(vid, VIA_TYPE[e.via.kind], input.items[key], e.via.name), at, levelOf(at) + step)
            const otherName = dir === 'up' ? e.from : e.to
            let otherId
            if (otherName == null) {
              otherId = `file:${key}`
              addNode({ id: otherId, type: 'file', label: e.via.file || 'A file', sub: e.via.kind === 'import' ? 'File loaded' : 'File written' }, vid, levelOf(vid) + step)
            } else {
              otherId = deNodeId(otherName)
              addNode(deNode(otherName, { ent: e.ent }), vid, levelOf(vid) + step)
              if (!seen[dir].has(norm(otherName))) { seen[dir].add(norm(otherName)); next.push(otherName) }
            }
            // Only the edge between the activity and a file is a file edge.
            if (dir === 'up') {
              addEdge(otherId, vid, otherName == null ? 'file' : 'reads')
              addEdge(vid, at, 'writes')
            } else {
              addEdge(at, vid, 'reads')
              addEdge(vid, otherId, otherName == null ? 'file' : 'writes')
            }
          }
        }
        frontier[dir] = next
      }
    }
  }

  // Hubs (profiles): a box per group between the focus and its items.
  for (const h of input.hubs) {
    addNode({ ...h, id: `hub:${h.id}` }, focusId, 1)
    addEdge(focusId, `hub:${h.id}`, 'uses', { label: '' })
  }

  // Everything else the scan found next to the focus. Not what lineage already
  // covers, shown or folded (live test, 2026-11-16: folded lineage queries were folded
  // a second time here and counted twice).
  const inLineage = new Set(input.edges.map((e) => viaKey(e.via)))
  const direct = input.uses.filter((u) => !inLineage.has(u.key))
  const events = new Map()
  for (const u of direct) if (u.type === 'event') events.set(norm(input.items[u.key]?.pivot?.event?.eventDefinitionKey), u.key)
  const startedBy = (u) => {
    if (u.type !== 'journey' || u.dir !== 'out') return null
    for (const k of input.items[u.key]?.entryKeys || []) if (events.has(norm(k))) return events.get(norm(k))
    return null
  }
  const anchorOf = (u) => (u.hub ? `hub:${u.hub}` : focusId)
  const place = (u, anchor, level) => {
    const item = input.items[u.key]
    const n = addNode(useNode(u, item), anchor, level)
    const opts = { possible: u.possible, label: u.label, state: n.state || '' }
    if (u.dir === 'in') addEdge(n.id, anchor, u.rel, opts)
    else addEdge(anchor, n.id, u.rel, opts)
    return n
  }
  const groups = new Map() // anchor + dir → uses
  const viaEvent = []
  for (const u of direct) {
    if (startedBy(u)) { viaEvent.push(u); continue }
    const k = `${anchorOf(u)}\n${u.dir}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(u)
  }
  for (const [k, list] of groups) {
    const [anchor, dir] = k.split('\n')
    const step = dir === 'in' ? -1 : 1
    const shown = fold(anchor, dir === 'in' ? 'up' : 'down', list, (x) => x.type, (x) => input.items[x.key]?.title)
    for (const u of shown) place(u, anchor, levelOf(anchor) + step)
  }
  // Journeys started by an entry event of the focus go after the event.
  for (const u of viaEvent) {
    const eventId = `act:${startedBy(u)}`
    if (!nodes.has(eventId)) continue // the event itself was folded away
    place({ ...u, rel: 'entry' }, eventId, levelOf(eventId) + 1)
  }

  // The automations that run each activity, in a band above (steps merged per pair).
  if (automations) {
    for (const n of [...nodes.values()]) {
      for (const a of n.item?.automations || []) {
        if (!a?.automationId) continue
        const id = `auto:${a.automationId}`
        if (id === focusId) continue
        const state = automationState(a.status)
        addNode({ id, type: 'automation', label: a.name || 'Automation', sub: ['Automation', statusWords(a.status)].filter(Boolean).join(' · '), band: true, state, item: { key: id, kind: 'Automation', title: a.name, badges: [{ text: a.status || '', tone: 'status' }], lines: [], route: `/automations/${encodeURIComponent(a.automationId)}` } }, n.id, n.level)
        const e = addEdge(id, n.id, 'runs', { state })
        e.steps = [...new Set([...(e.steps || []), a.step].filter((s) => s != null))].sort((x, y) => x - y)
        e.label = e.steps.length ? `step${e.steps.length > 1 ? 's' : ''} ${e.steps.join(', ')}` : 'runs'
      }
    }
  }
  for (const e of edges.values()) {
    if (e.rel === 'runs' && !e.state) e.state = nodes.get(e.source)?.state || ''
  }

  // A node is "possible" when every edge that put it on the map is a possible match.
  const out = [...nodes.values()]
  const all = [...edges.values()]
  for (const n of out) {
    const touching = all.filter((e) => e.rel !== 'runs' && (e.source === n.id || e.target === n.id))
    n.possible = touching.length > 0 && touching.every((e) => e.possible)
  }
  return { nodes: out, edges: all, hidden }
}

/**
 * The nodes and edges lit while a node is hovered or selected: it, its direct
 * neighbours, and the chain of parents back to the focus.
 */
export function litSet(map, id) {
  if (!id) return null
  const nodes = new Set([id])
  const edges = new Set()
  for (const e of map.edges) {
    if (e.source === id || e.target === id) { nodes.add(e.source); nodes.add(e.target); edges.add(e.id) }
  }
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  let cur = byId.get(id)
  while (cur?.parent) {
    const p = cur.parent
    for (const e of map.edges) if ((e.source === p && e.target === cur.id) || (e.source === cur.id && e.target === p)) edges.add(e.id)
    nodes.add(p)
    cur = byId.get(p)
  }
  return { nodes, edges }
}

/**
 * The key as a filter: the edges of the picked kinds or states, and their ends.
 * `picked` holds edge kinds (reads, writes, …) and states (possible, paused, error).
 */
export function filterSet(map, picked) {
  if (!picked?.size) return null
  const nodes = new Set()
  const edges = new Set()
  for (const e of map.edges) {
    const hit = picked.has(e.rel) || (e.possible && picked.has('possible')) || (e.state && picked.has(e.state))
    if (hit) { edges.add(e.id); nodes.add(e.source); nodes.add(e.target) }
  }
  return { nodes, edges }
}
