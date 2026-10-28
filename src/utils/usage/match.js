// Pure matching for "Where used": which tables a query reads, how a query uses a DE
// or one of its fields, data extensions and content blocks named in AMPscript or
// SSJS, values buried in JSON of unknown shape, and the automation index.
import { extractDataExtensions, extractSelectColumns } from '../sqlParser.js'

export const norm = (s) => String(s ?? '').trim().toLowerCase()
const stripEnt = (s) => String(s || '').replace(/^\s*(?:\[ent\]|ent)\s*\.\s*/i, '').replace(/^\[|\]$/g, '').trim()
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Comments and string literals blanked out; [bracketed names] kept as they are.
export function stripSql(sql) {
  return String(sql || '').replace(/\[[^\]]*\]|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '[' ? m : ' '))
}

const TABLE_RE = /\b(?:FROM|JOIN)\s+((?:\[[^\]]+\]|\w+)\s*\.\s*)?(\[[^\]]+\]|[\w-]+)/gi

/**
 * The tables a query reads, with whether they were written as ENT.<name>. Covers
 * subqueries (regex over the SQL without comments and strings) and comma joins
 * (the parser), case-insensitive and deduped by name.
 * @returns {{ name: string, ent: boolean }[]}
 */
export function tablesInSql(sql) {
  const found = new Map()
  const add = (name, ent) => {
    const n = String(name || '').replace(/^\[|\]$/g, '').trim()
    if (!n) return
    const k = n.toLowerCase()
    const prev = found.get(k)
    found.set(k, { name: prev?.name || n, ent: !!(prev?.ent || ent) })
  }
  const text = stripSql(sql)
  let m
  TABLE_RE.lastIndex = 0
  while ((m = TABLE_RE.exec(text)) !== null) {
    const prefix = (m[1] || '').replace(/[\s.[\]]/g, '').toLowerCase()
    add(m[2], prefix === 'ent')
  }
  for (const t of extractDataExtensions(text)) add(t, false)
  return [...found.values()]
}

/**
 * True when a query's target is this DE: by key or ID, or by name when the query or
 * the DE (one known only by name) has neither.
 */
export function queryWritesDE(q, de) {
  const key = norm(de.customerKey)
  const id = norm(de.id)
  if (!key && !id) return !!de.name && norm(q.targetName) === norm(de.name)
  if (q.targetKey || q.targetId) return (!!key && norm(q.targetKey) === key) || (!!id && norm(q.targetId) === id)
  return !!de.name && norm(q.targetName) === norm(de.name)
}

/**
 * How one query activity uses the DE: writes (it is the target) and reads (it is in
 * FROM or JOIN). Null when it does neither.
 */
export function matchQuery(q, de) {
  const writes = !de.dataView && queryWritesDE(q, de)
  const read = tablesInSql(q.queryText).find((t) => norm(t.name) === norm(de.name))
  if (!writes && !read) return null
  return { writes, reads: !!read, viaEnt: !!read?.ent }
}

const NOT_ALIAS = new Set(['where', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'on', 'group', 'order', 'union', 'having', 'with', 'as', 'and', 'or', 'select', 'from'])

/** Aliases a query gives one table (its name counts as one too). */
function aliasesFor(text, name) {
  const n = escapeRe(name)
  const re = new RegExp(`\\b(?:FROM|JOIN)\\s+(?:(?:\\[ent\\]|ent)\\s*\\.\\s*)?(?:\\[${n}\\]|${n}(?![\\w-]))(?:\\s+(?:AS\\s+)?(\\[[^\\]]+\\]|\\w+))?`, 'gi')
  const out = new Set([norm(name)])
  let m
  while ((m = re.exec(text)) !== null) {
    const a = m[1] ? m[1].replace(/^\[|\]$/g, '') : ''
    if (a && !NOT_ALIAS.has(a.toLowerCase())) out.add(norm(a))
  }
  return out
}

/**
 * How a query uses one field of a DE: 'reads' with certainty 'yes' (qualified with the
 * DE or its alias, or the only table), 'maybe' (unqualified in a query with several
 * tables) or 'all' (SELECT * from it alone); 'writes' when the query targets the DE
 * and selects a column of that name. Null when neither.
 */
export function matchField(q, de, field) {
  const text = stripSql(q.queryText)
  const f = escapeRe(field)
  const writes = !de.dataView && queryWritesDE(q, de) &&
    extractSelectColumns(q.queryText || '').some((c) => norm(c) === norm(field))
  const tables = tablesInSql(q.queryText)
  const readsDE = tables.some((t) => norm(t.name) === norm(de.name))
  let reads = null
  if (readsDE) {
    const aliases = aliasesFor(text, de.name)
    const qualified = new RegExp(`(\\[[^\\]]+\\]|[\\w-]+)\\s*\\.\\s*(?:\\[${f}\\]|${f}(?![\\w-]))`, 'gi')
    let m
    while ((m = qualified.exec(text)) !== null) {
      if (aliases.has(norm(m[1].replace(/^\[|\]$/g, '')))) { reads = 'yes'; break }
    }
    if (!reads) {
      const bare = new RegExp(`(?<![.\\w-])(?:\\[${f}\\]|${f}(?![\\w-]))(?!\\s*\\.)`, 'i')
      if (bare.test(text)) reads = tables.length === 1 ? 'yes' : 'maybe'
      else if (tables.length === 1 && /\bselect\s+(?:top\s+\d+\s+)?(?:distinct\s+)?\*/i.test(text)) reads = 'all'
    }
  }
  if (!writes && !reads) return null
  return { writes, reads }
}

// ── AMPscript and SSJS ────────────────────────────────────
const AMP_DE_FN = /\b(Lookup|LookupRows|LookupRowsCS|LookupOrderedRows|LookupOrderedRowsCS|UpsertData|UpsertDE|InsertData|InsertDE|UpdateData|UpdateDE|DeleteData|DeleteDE|ClaimRow|ClaimRowValue|DataExtensionRowCount)\s*\(\s*(["'])([^"']+)\2([^)]*)\)?/gi
const SSJS_INIT = /\bDataExtension\.Init\s*\(\s*(["'])([^"']+)\1/gi
const DE_OBJECT = /\bDataExtensionObject\[([^\]]+)\]/gi

/**
 * Data extensions named in AMPscript or SSJS: Lookup/LookupRows/Upsert...("name", ...)
 * (also Platform.Function.*), DataExtension.Init("key") and DataExtensionObject[key].
 * @returns {{ ref: string, fn: string, args: string, by: 'name' | 'key' }[]}
 */
export function deRefsInCode(text) {
  const s = String(text || '')
  const out = []
  let m
  AMP_DE_FN.lastIndex = 0
  while ((m = AMP_DE_FN.exec(s)) !== null) out.push({ ref: stripEnt(m[3]), fn: m[1], args: m[4] || '', by: 'name' })
  SSJS_INIT.lastIndex = 0
  while ((m = SSJS_INIT.exec(s)) !== null) out.push({ ref: stripEnt(m[2]), fn: 'DataExtension.Init', args: '', by: 'key' })
  DE_OBJECT.lastIndex = 0
  while ((m = DE_OBJECT.exec(s)) !== null) out.push({ ref: stripEnt(m[1].replace(/["']/g, '')), fn: 'DataExtensionObject', args: '', by: 'key' })
  return out
}

/** The calls in `text` that name this DE (by name or customer key). */
/**
 * True when `text` names the DE (name or key, at least 4 characters) as a whole
 * word anywhere, not only in a Lookup or similar call: WSProxy calls, strings kept in
 * variables, plain text (feedback #55). Lower confidence than codeRefsToDE.
 */
export function mentionsName(text, de) {
  const s = String(text || '')
  return [de.name, de.customerKey].filter((n) => n && String(n).length >= 4).some((n) => {
    const esc = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^A-Za-z0-9_])${esc}($|[^A-Za-z0-9_])`, 'i').test(s)
  })
}

export function codeRefsToDE(text, de) {
  const names = new Set([norm(de.name), norm(de.customerKey)].filter(Boolean))
  return deRefsInCode(text).filter((r) => names.has(norm(r.ref)))
}

const CB_KEY = /\bContentBlockByKey\s*\(\s*(["'])([^"']+)\1/gi
const CB_ID = /\bContentBlockByID\s*\(\s*["']?(\d+)/gi
const CB_NAME = /\b(?:ContentBlockByName|ContentAreaByName)\s*\(\s*(["'])([^"']+)\1/gi

/** How `text` names a content block: by key, ID or name (a path ending in the name). */
export function contentBlockRefs(text, block) {
  const s = String(text || '')
  const out = []
  let m
  CB_KEY.lastIndex = 0
  while ((m = CB_KEY.exec(s)) !== null) if (block.customerKey && norm(m[2]) === norm(block.customerKey)) out.push('ContentBlockByKey')
  CB_ID.lastIndex = 0
  while ((m = CB_ID.exec(s)) !== null) if (String(m[1]) === String(block.id)) out.push('ContentBlockByID')
  CB_NAME.lastIndex = 0
  while ((m = CB_NAME.exec(s)) !== null) {
    const last = m[2].split(/[\\/]/).pop()
    if (block.name && norm(last) === norm(block.name)) out.push('ContentBlockByName')
  }
  return [...new Set(out)]
}

// ── Content Builder assets ────────────────────────────────
const TEXT_PARTS = ['content', 'superContent', 'design', 'views', 'slots', 'blocks']

/** All the text in an asset (HTML, AMPscript, subject lines), from every view, slot and block. */
export function assetText(asset) {
  const out = []
  const walk = (v, depth) => {
    if (depth > 12 || v == null) return
    if (typeof v === 'string') { out.push(v); return }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return }
    if (typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1)
  }
  for (const k of TEXT_PARTS) walk(asset?.[k], 0)
  return out.join('\n')
}

/** True when a block with this asset ID sits in one of the asset's slots. */
export function assetPlacesBlock(asset, blockId) {
  let found = false
  const walk = (v, depth) => {
    if (found || depth > 12 || !v || typeof v !== 'object') return
    if (!Array.isArray(v) && String(v.id) === String(blockId) && (v.assetType || v.content != null)) { found = true; return }
    for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(asset?.slots, 0)
  walk(asset?.blocks, 0)
  return found
}

// ── JSON of unknown shape ─────────────────────────────────
/**
 * Paths in `obj` whose value equals one of `values` (case-insensitive), optionally
 * only where the path matches `keyRe`. Used where SFMC's shape is not documented.
 * @returns {string[]} dotted paths
 */
export function findValues(obj, values, keyRe = null) {
  const wanted = new Set(values.filter((v) => v != null && v !== '').map((v) => norm(v)))
  const hits = []
  if (!wanted.size) return hits
  const walk = (v, path, depth) => {
    if (depth > 14 || v == null) return
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1)
      return
    }
    if (wanted.has(norm(v)) && (!keyRe || keyRe.test(path))) hits.push(path)
  }
  walk(obj, '', 0)
  return hits
}

/** Strings in `obj` that name `name` as a path part (Contact.Attribute.<name>.Field). */
export function findPathMentions(obj, name, field = null) {
  if (!name) return []
  const tail = field ? `\\.\\[?${escapeRe(field)}(?![\\w-])` : '\\.[\\w\\[]'
  return findStrings(obj, new RegExp(`(^|[.\\s"'>=\\[])${escapeRe(name)}\\]?${tail}`, 'i'))
}

/** Paths of the strings in `obj` that match `re`. */
export function findStrings(obj, re) {
  const hits = []
  const walk = (v, path, depth) => {
    if (depth > 14 || v == null) return
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1); return }
    if (typeof v === 'string' && re.test(v)) hits.push(path)
  }
  walk(obj, '', 0)
  return hits
}

/**
 * Profiles named in `obj` under keys matching `keyRe` (senderProfileId, or an object
 * like sendClassification: { id, name }). @returns {{ id: string, name: string }[]}
 */
export function collectProfileRefs(obj, keyRe) {
  const out = new Map()
  const walk = (v, depth) => {
    if (depth > 14 || v == null || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (keyRe.test(k) && x != null && x !== '') {
        if (typeof x === 'object' && !Array.isArray(x)) {
          const id = x.id ?? x.customerKey ?? x.objectId ?? x.objectID
          if (id != null && id !== '') out.set(norm(id), { id: String(id), name: x.name || out.get(norm(id))?.name || '' })
        } else if (typeof x !== 'object') {
          if (!out.has(norm(x))) out.set(norm(x), { id: String(x), name: '' })
        }
      }
      walk(x, depth + 1)
    }
  }
  walk(obj, 0)
  return [...out.values()]
}

// ── Automations ───────────────────────────────────────────
/**
 * activityObjectId (lower case) → where it runs: [{ automationId, step, stepName,
 * objectTypeId, activityName }], for every activity type.
 */
export function buildActivityIndex(automations) {
  const index = new Map()
  for (const a of automations) {
    ;(a?.steps || []).forEach((step, si) => {
      const stepNo = step?.step ?? si + 1
      for (const act of step?.activities || []) {
        if (!act?.activityObjectId) continue
        const k = norm(act.activityObjectId)
        const list = index.get(k) || []
        if (!list.some((e) => e.automationId === a.id && e.step === stepNo)) {
          list.push({ automationId: a.id, step: stepNo, stepName: step.name || '', objectTypeId: Number(act.objectTypeId), activityName: act.name || '' })
        }
        index.set(k, list)
      }
    })
  }
  return index
}

// ── Lineage ───────────────────────────────────────────────
/**
 * Edges between data extensions, by lower-case name: queries (each table read → its
 * target), filters (source → result), plus imports (a file → DE) and data extracts
 * (DE → a file) as ends. `edges` are { from, to, via: { kind, name, id } } where
 * from/to are names, or null for a file.
 */
export function lineageEdges({ queries = [], filters = [], imports = [], extracts = [], deNameById = new Map(), deNameByKey = new Map() }) {
  const edges = []
  for (const q of queries) {
    const to = q.targetName || deNameByKey.get(norm(q.targetKey)) || null
    if (!to) continue
    for (const t of tablesInSql(q.queryText)) {
      edges.push({ from: t.name, to, via: { kind: 'query', name: q.name, id: q.queryDefinitionId } })
    }
  }
  for (const f of filters) {
    const from = f.sourceObjectName || deNameById.get(norm(f.sourceObjectId)) || null
    const to = f.resultDEName || f.destinationObjectName || deNameById.get(norm(f.destinationObjectId)) || null
    if (from && to) edges.push({ from, to, via: { kind: 'filter', name: f.name, id: f.filterActivityId } })
  }
  for (const i of imports) {
    const to = i.targetDataExtension?.name || i.destinationName || deNameById.get(norm(i.destinationObjectId)) || null
    if (to) edges.push({ from: null, to, via: { kind: 'import', name: i.name, id: i.importDefinitionId, file: i.fileNamingPattern || i.fileSpec || '' } })
  }
  for (const x of extracts) {
    const key = (x.dataFields || []).find((f) => /^DECustomerKey$/i.test(f?.name))?.value
    const from = key ? (deNameByKey.get(norm(key)) || key) : null
    if (from) edges.push({ from, to: null, via: { kind: 'extract', name: x.name, id: x.dataExtractDefinitionId, file: x.fileSpec || '' } })
  }
  return edges
}

/**
 * Upstream (where the DE's data comes from) or downstream (where it goes) as a tree:
 * { name, via, children, cycle? } to `maxDepth` levels. A DE already on the path is
 * marked as a cycle and not followed again.
 */
export function lineageTree(edges, name, direction, maxDepth = 6) {
  const byNode = new Map()
  for (const e of edges) {
    const k = direction === 'up' ? norm(e.to) : norm(e.from)
    if (!k) continue
    if (!byNode.has(k)) byNode.set(k, [])
    byNode.get(k).push(e)
  }
  const build = (n, depth, seen) => {
    const list = byNode.get(norm(n)) || []
    if (depth >= maxDepth) return { children: [], truncated: list.length > 0 }
    const children = list.map((e) => {
      const next = direction === 'up' ? e.from : e.to
      if (next == null) return { name: null, via: e.via, children: [] }
      if (seen.has(norm(next))) return { name: next, via: e.via, children: [], cycle: true }
      const sub = build(next, depth + 1, new Set([...seen, norm(next)]))
      return { name: next, via: e.via, ...sub }
    })
    return { children }
  }
  return { name, ...build(name, 0, new Set([norm(name)])) }
}
