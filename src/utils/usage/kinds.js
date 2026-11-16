// What "Where used" checks for each kind of thing, and how the results are laid out.
// Each kind lists its stages (the sources it may load, in order) and an analyze()
// that loads them through ctx.get(id) and returns { sections }.
//
// A section: { id, title, items, empty?, note?, tree? }
// An item:   { key, kind, title, badges: [{ text, tone }], lines: [], route?, href?,
//              code?: { text, lang }, activityObjectId?, automations?, pivot? }
import { sfmcFetch } from '../sfmcApi.js'
import { describeActivity, activityTypeLabel, activityEndpoint, UPDATE_TYPES } from '../activityTypes.js'
import { formatDateTime, plural, statusWords } from '../format.js'
import { runInBatches } from '../batchRunner.js'
import { SOURCES, assetGroup } from './sources.js'
import { mapInput, reachableLineage, viaKey, useOf, activityMapType } from './graph.js'
import { eventAutomationId } from '../journeyApi.js'
import { primaryVersion } from '../journeys.js'
import {
  norm, matchQuery, matchField, tablesInSql, codeRefsToDE, mentionsName, contentBlockRefs, assetText, assetPlacesBlock,
  findValues, findPathMentions, collectProfileRefs, lineageEdges, lineageTree, deRefsInCode,
} from './match.js'

const AS = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`
const label = (id) => SOURCES[id]?.label || id
const stage = (id, text) => ({ id, label: text || label(id) })
const ANALYSE = { id: 'analyse', label: 'Matching' }

const GROUP_TITLES = { email: 'Emails', template: 'Templates', block: 'Content blocks', cloudpage: 'CloudPages', other: 'Other content' }
const modified = (d) => (d ? `Modified ${formatDateTime(d)}` : '')
const deOf = (name) => ({ kind: 'de', de: { name } })

// ── Shared item builders ──────────────────────────────────
function activityItem(stack, typeId, details, extra = {}) {
  const idField = { 300: 'queryDefinitionId', 43: 'importDefinitionId', 303: 'filterActivityId', 73: 'dataExtractDefinitionId', 53: 'id', 423: 'ssjsActivityId' }[typeId]
  const id = details[idField] ?? details.id
  return {
    key: `${typeId}:${id}`,
    kind: activityTypeLabel(typeId),
    title: details.name || activityTypeLabel(typeId),
    badges: [],
    lines: [],
    href: describeActivity(typeId, details, stack).link || null,
    activityObjectId: id,
    ...extra,
  }
}

// The journeys source lists every version of each journey (live test, 2026-11-07: a
// Draft version 3 hid the Published version 2). One item per journey, for the matching
// versions: it opens the published (or otherwise live) one, else the newest, and lists
// the others with their status.
function journeyItem(j, reasons, others = [], extra = {}) {
  return {
    key: `j:${j.id}`,
    kind: 'Journey',
    title: j.name || j.key || j.id,
    badges: [{ text: j.status || '', tone: 'status' }],
    lines: [...reasons, [j.version ? `Version ${j.version}` : '', modified(j.modifiedDate)].filter(Boolean).join(' · '),
      others.length ? `Also in ${others.map((o) => `version ${o.version}${o.status ? ` (${o.status})` : ''}`).join(', ')}` : ''].filter(Boolean),
    route: `/journeys/${encodeURIComponent(j.id)}${j.version ? `?version=${encodeURIComponent(j.version)}` : ''}`,
    journeyId: j.id,
    version: j.version ?? null,
    status: j.status || '',
    ...extra,
  }
}

/**
 * Items for matching journey versions: `matches` is [[journeyVersion, reasons, extra?]];
 * `extra` (such as the entry event keys, for the map) goes onto the item.
 */
function journeyItems(matches) {
  const byId = new Map()
  for (const [j, reasons, extra] of matches) {
    if (!byId.has(j.id)) byId.set(j.id, [])
    byId.get(j.id).push({ j, reasons, extra })
  }
  return [...byId.values()].map((list) => {
    const main = primaryVersion(list.map((m) => m.j))
    const others = list.map((m) => m.j).filter((j) => j !== main).sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
    const m = list.find((x) => x.j === main)
    return journeyItem(main, m.reasons, others, m.extra)
  })
}

function assetItem(a, lines, badges = []) {
  return {
    key: `a:${a.id}`,
    kind: a.assetType?.displayName || a.assetType?.name || 'Asset',
    title: a.name || `Asset ${a.id}`,
    badges,
    lines: [...lines, [a.category?.name ? `Folder ${a.category.name}` : '', modified(a.modifiedDate)].filter(Boolean).join(' · ')].filter(Boolean),
  }
}

/** Fills in the automations each item with an activityObjectId runs in. */
async function attachAutomations(ctx, sections) {
  const items = sections.flatMap((s) => s.items || []).filter((i) => i.activityObjectId)
  if (!items.length) return
  const autos = await ctx.get('automations')
  for (const i of items) {
    if (!autos) { i.automations = null; continue }
    i.automations = (autos.index.get(norm(i.activityObjectId)) || []).map((e) => {
      const a = autos.byId.get(e.automationId) || {}
      return { ...e, name: a.name || e.automationId, status: a.status ?? '', lastRunTime: a.lastRunTime || null }
    })
  }
}

function section(id, title, items, { empty, note, source } = {}) {
  return { id, title, items, empty: empty || 'None found.', note: note || '', unavailable: source === null }
}

// ── Data extensions (and data views) ──────────────────────
function queryItems(stack, queries, de) {
  const items = []
  for (const q of queries) {
    const m = matchQuery(q, de)
    if (!m) continue
    const upd = q.targetUpdateTypeName || UPDATE_TYPES[q.targetUpdateTypeId] || ''
    items.push(activityItem(stack, 300, q, {
      badges: [
        ...(m.writes ? [{ text: upd ? `Writes: ${upd}` : 'Writes', tone: 'write' }] : []),
        ...(m.reads ? [{ text: m.viaEnt ? 'Reads (ENT.)' : 'Reads', tone: 'read' }] : []),
      ],
      lines: [!m.writes && q.targetName ? `Target: ${q.targetName}` : '', modified(q.modifiedDate)].filter(Boolean),
      code: { text: q.queryText || '', lang: 'sql' },
      pivot: !m.writes && q.targetName ? deOf(q.targetName) : null,
      writes: m.writes,
    }))
  }
  return items.sort((a, b) => (b.writes - a.writes) || a.title.localeCompare(b.title))
}

function nameMaps(queries, de) {
  const byId = new Map()
  const byKey = new Map()
  for (const q of queries) {
    if (q.targetName && q.targetId) byId.set(norm(q.targetId), q.targetName)
    if (q.targetName && q.targetKey) byKey.set(norm(q.targetKey), q.targetName)
  }
  if (de.id) byId.set(norm(de.id), de.name)
  if (de.customerKey) byKey.set(norm(de.customerKey), de.name)
  return { deNameById: byId, deNameByKey: byKey }
}

async function analyseDE(target, ctx) {
  const de = target.de
  const { stack } = ctx
  const sections = []
  const queries = await ctx.get('queries')
  sections.push(section('queries', 'SQL Query activities', queries ? queryItems(stack, queries.items, de) : [], {
    source: queries, note: queries?.capped ? 'Only the newest 2,000 Query activities were checked.' : '',
  }))

  if (de.dataView) {
    const edges = lineageEdges({ queries: queries?.items || [] })
    sections.unshift({ id: 'lineage', title: 'Lineage', tree: { up: null, down: lineageTree(edges, de.name, 'down') }, items: [] })
    return withMap(ctx, de, sections, edges, { queries: queries?.items || [] })
  }

  const ids = [de.id, de.customerKey].filter(Boolean)
  const isDE = (id, name, key) => (!!de.id && norm(id) === norm(de.id)) || (!!de.customerKey && norm(key) === norm(de.customerKey)) || (!!name && norm(name) === norm(de.name))

  const imports = await ctx.get('imports')
  const importItems = (imports?.items || []).filter((i) => isDE(i.destinationObjectId, i.targetDataExtension?.name || i.destinationName, i.targetDataExtension?.customerKey))
    .map((i) => activityItem(stack, 43, i, {
      badges: [{ text: `Writes: ${UPDATE_TYPES[i.updateTypeId] || 'import'}`, tone: 'write' }],
      lines: [i.fileNamingPattern || i.fileSpec ? `File: ${i.fileNamingPattern || i.fileSpec}` : '', modified(i.modifiedDate)].filter(Boolean),
    }))
  sections.push(section('imports', 'Import activities', importItems, { source: imports }))

  const filters = await ctx.get('filters')
  const filterItems = []
  for (const f of filters?.items || []) {
    const src = isDE(f.sourceObjectId, f.sourceObjectName, null)
    const dst = isDE(f.destinationObjectId, f.resultDEName || f.destinationObjectName, f.resultDEKey)
    if (!src && !dst) continue
    filterItems.push(activityItem(stack, 303, f, {
      badges: [...(dst ? [{ text: 'Writes (result)', tone: 'write' }] : []), ...(src ? [{ text: 'Reads (source)', tone: 'read' }] : [])],
      lines: [src && (f.resultDEName || f.destinationObjectName) ? `Result: ${f.resultDEName || f.destinationObjectName}` : '', modified(f.modifiedDate)].filter(Boolean),
    }))
  }
  sections.push(section('filters', 'Filter activities', filterItems, { source: filters }))

  const extracts = await ctx.get('dataextracts')
  const extractItems = (extracts?.items || []).filter((x) => findValues(x.dataFields, ids).length || (x.dataFields || []).some((f) => /^DECustomerKey$/i.test(f?.name) && norm(f.value) === norm(de.name)))
    .map((x) => activityItem(stack, 73, x, { badges: [{ text: 'Reads (extract)', tone: 'read' }], lines: [x.fileSpec ? `File: ${x.fileSpec}` : '', modified(x.modifiedDate)].filter(Boolean) }))
  sections.push(section('extracts', 'Data Extract activities', extractItems, { source: extracts }))

  const scripts = await ctx.get('scripts')
  const scriptItems = []
  for (const s of scripts?.items || []) {
    const refs = codeRefsToDE(s.script, de)
    if (refs.length) scriptItems.push(activityItem(stack, 423, s, { badges: [{ text: 'Named in code', tone: 'maybe' }], lines: [`${[...new Set(refs.map((r) => r.fn))].join(', ')}`, modified(s.modifiedDate)], code: { text: s.script || '', lang: 'javascript' } }))
  }
  sections.push(section('scripts', 'Script activities', scriptItems, { source: scripts, note: 'Found by the data extension\'s name or key in DataExtension.Init, Lookup and similar calls. A name built in code cannot be found.' }))

  const sends = await ctx.get('emailsends')
  const sendItems = (sends?.items || []).filter((s) => findValues(s.definition, ids).length)
    .map((s) => ({ key: `42:${s.activityObjectId}`, kind: 'Send Email activity', title: s.name || 'Send Email', badges: [{ text: 'Audience', tone: 'read' }], lines: [], activityObjectId: s.activityObjectId }))
  sections.push(section('sends', 'Send Email activities', sendItems, { source: sends }))

  const events = await ctx.get('events')
  const eventMatches = (events?.items || []).filter((e) => isDE(e.dataExtensionId, e.dataExtensionName, null))
  sections.push(section('events', 'Journey entry events', eventMatches.map((e) => ({
    key: `e:${e.id}`, kind: 'Entry event', title: e.name || e.eventDefinitionKey, badges: [{ text: 'Entry source', tone: 'read' }],
    lines: [`Key ${e.eventDefinitionKey}`, Number(e.publishedInteractionCount) ? `In ${plural(e.publishedInteractionCount, 'published journey version')}` : 'In no published journey'],
    pivot: { kind: 'event', event: e },
  })), { source: events }))

  const journeys = await ctx.get('journeys')
  const eventKeys = new Set(eventMatches.map((e) => norm(e.eventDefinitionKey)))
  const journeyMatches = []
  for (const j of journeys?.items || []) {
    const reasons = []
    const trig = (j.triggers || []).find((t) => eventKeys.has(norm(t.metaData?.eventDefinitionKey || t.configurationArguments?.eventDefinitionKey)))
    if (trig) reasons.push('Entry source')
    if (findValues(j.activities, ids).length) reasons.push('Named in an activity (such as Update Contact)')
    const paths = findPathMentions({ activities: j.activities, goals: j.goals, exits: j.exits }, de.name)
    if (paths.length) reasons.push('In split, goal or exit criteria')
    const entryKeys = trig ? [trig.metaData?.eventDefinitionKey || trig.configurationArguments?.eventDefinitionKey] : []
    if (reasons.length) journeyMatches.push([j, [reasons.join('; ')], { entryKeys }])
  }
  sections.push(section('journeys', 'Journeys', journeyItems(journeyMatches), { source: journeys, note: journeys?.errors ? `${plural(journeys.errors, 'journey version')} could not be read.` : '' }))

  const assets = await ctx.get('assets')
  const byGroup = {}
  for (const a of assets?.items || []) {
    const text = assetText(a)
    const refs = codeRefsToDE(text, de)
    const g = assetGroup(a)
    if (refs.length) {
      ;(byGroup[g] = byGroup[g] || []).push(assetItem(a, [[...new Set(refs.map((r) => r.fn))].join(', ')], [{ text: 'Named in AMPscript or SSJS', tone: 'maybe' }]))
    } else if (mentionsName(text, de)) {
      // The name appears some other way (WSProxy, a variable, page text): worth a look.
      ;(byGroup[g] = byGroup[g] || []).push(assetItem(a, ['The name appears in the content'], [{ text: 'Mentions the name', tone: 'maybe' }]))
    }
  }
  sections.push(section('content', 'Emails, templates, content blocks and CloudPages', Object.entries(byGroup).flatMap(([g, list]) => list.map((i) => ({ ...i, kind: GROUP_TITLES[g].replace(/s$/, '') }))), {
    source: assets, note: `Found by the data extension's name or key in Lookup, LookupRows, UpsertData and similar calls, or anywhere in the content (Mentions the name).${assets?.capped ? ' Only the newest 5,000 items were checked.' : ''}`,
  }))

  // Lineage from queries, filters, imports and extracts.
  const maps = nameMaps(queries?.items || [], de)
  const edges = lineageEdges({ queries: queries?.items || [], filters: filters?.items || [], imports: imports?.items || [], extracts: extracts?.items || [], ...maps })
  sections.unshift({ id: 'lineage', title: 'Lineage', tree: { up: lineageTree(edges, de.name, 'up'), down: lineageTree(edges, de.name, 'down') }, items: [] })
  return withMap(ctx, de, sections, edges, { queries: queries?.items || [], filters: filters?.items || [], imports: imports?.items || [], extracts: extracts?.items || [] })
}

// The map (graph.js): items for lineage activities further away than the sections
// reach, so every box has a name, a link to SFMC and its automations.
const VIA_SOURCE = {
  query: ['queries', 300, 'queryDefinitionId'], filter: ['filters', 303, 'filterActivityId'],
  import: ['imports', 43, 'importDefinitionId'], extract: ['extracts', 73, 'dataExtractDefinitionId'],
}
async function withMap(ctx, de, sections, edges, lists) {
  const reach = reachableLineage(edges, de.name)
  const known = new Set(sections.flatMap((s) => (s.items || []).map((i) => i.key)))
  const extra = new Map()
  for (const e of reach) {
    const key = viaKey(e.via)
    if (known.has(key) || extra.has(key)) continue
    const [list, typeId, idField] = VIA_SOURCE[e.via.kind]
    const details = (lists[list] || []).find((x) => String(x[idField]) === String(e.via.id))
    if (details) extra.set(key, activityItem(ctx.stack, typeId, details))
  }
  await attachAutomations(ctx, [...sections, { items: [...extra.values()] }])
  return { sections, map: mapInput({ de, edges: reach, sections, extraItems: [...extra.values()] }) }
}

// ── One field of a DE ─────────────────────────────────────
async function analyseField(target, ctx) {
  const { de, field } = target
  const sections = []
  const queries = await ctx.get('queries')
  const items = []
  for (const q of queries?.items || []) {
    const m = matchField(q, de, field)
    if (!m) continue
    items.push(activityItem(ctx.stack, 300, q, {
      badges: [
        ...(m.writes ? [{ text: 'Writes', tone: 'write' }] : []),
        ...(m.reads === 'yes' ? [{ text: 'Reads', tone: 'read' }] : m.reads === 'maybe' ? [{ text: 'Maybe reads (unqualified)', tone: 'maybe' }] : m.reads === 'all' ? [{ text: 'Reads (SELECT *)', tone: 'read' }] : []),
      ],
      lines: [q.targetName && !m.writes ? `Target: ${q.targetName}` : '', modified(q.modifiedDate)].filter(Boolean),
      code: { text: q.queryText || '', lang: 'sql' },
    }))
  }
  sections.push(section('queries', 'SQL Query activities', items, { source: queries }))

  if (!de.dataView) {
    const journeys = await ctx.get('journeys')
    const jItems = journeyItems((journeys?.items || []).filter((j) => findPathMentions({ activities: j.activities, goals: j.goals, exits: j.exits }, de.name, field).length)
      .map((j) => [j, ['In split, goal or exit criteria']]))
    sections.push(section('journeys', 'Journeys', jItems, { source: journeys }))

    const assets = await ctx.get('assets')
    const quoted = new RegExp(`["']${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')
    const aItems = []
    for (const a of assets?.items || []) {
      const refs = codeRefsToDE(assetText(a), de).filter((r) => quoted.test(r.args))
      if (refs.length) aItems.push(assetItem(a, [[...new Set(refs.map((r) => r.fn))].join(', ')], [{ text: 'Named in AMPscript', tone: 'maybe' }]))
    }
    sections.push(section('content', 'Emails, templates, content blocks and CloudPages', aItems, { source: assets, note: 'Lookup and similar calls on this data extension that name the field.' }))
  }
  await attachAutomations(ctx, sections)
  const uses = []
  for (const i of items) {
    const writes = i.badges.some((b) => b.tone === 'write')
    uses.push(useOf(i, 'query', writes ? 'in' : 'out', writes ? 'writes' : 'reads'))
  }
  for (const x of sections.filter((y) => y.id !== 'queries')) for (const i of x.items) uses.push(useOf(i, x.id === 'journeys' ? 'journey' : 'content', 'out', 'uses'))
  const focus = { id: `focus:field:${norm(de.name)}.${norm(field)}`, type: 'field', label: field, sub: `Field of ${de.name} · checked` }
  return { sections, map: mapInput({ focus, sections, uses }) }
}

// ── One automation activity ───────────────────────────────
async function analyseActivity(target, ctx) {
  const autos = await ctx.get('automations')
  const list = autos ? autos.index.get(norm(target.activityObjectId)) || [] : []
  const items = list.map((e) => {
    const a = autos.byId.get(e.automationId) || {}
    return {
      key: `au:${e.automationId}:${e.step}`, kind: 'Automation', title: a.name || e.automationId,
      badges: [{ text: a.status || '', tone: 'status' }],
      lines: [`Step ${e.step}${e.stepName ? ` (${e.stepName})` : ''}${e.activityName ? `: ${e.activityName}` : ''}`, a.lastRunTime ? `Last run ${formatDateTime(a.lastRunTime)}` : ''].filter(Boolean),
      route: `/automations/${encodeURIComponent(e.automationId)}`,
      automationId: e.automationId,
      step: e.step,
    }
  })
  const sections = [section('automations', 'Automations', items, { source: autos, empty: 'Not in any automation.' })]
  if (target.typeId === 300 && target.details) {
    const q = target.details
    const reads = tablesInSql(q.queryText).map((t) => ({ key: `r:${t.name}`, kind: 'Data extension', title: t.name, badges: [{ text: t.ent ? 'Reads (ENT.)' : 'Reads', tone: 'read' }], lines: [], pivot: deOf(t.name) }))
    const writes = q.targetName ? [{ key: `w:${q.targetName}`, kind: 'Data extension', title: q.targetName, badges: [{ text: `Writes${q.targetUpdateTypeName ? `: ${q.targetUpdateTypeName}` : ''}`, tone: 'write' }], lines: [], pivot: { kind: 'de', de: { name: q.targetName, customerKey: q.targetKey, id: q.targetId } } }] : []
    sections.push(section('tables', 'Data extensions', [...writes, ...reads]))
  }
  const uses = []
  for (const i of items) uses.push(useOf(i, 'automation', 'in', 'runs', { label: `step ${i.step}` }))
  for (const i of sections.find((x) => x.id === 'tables')?.items || []) {
    const writes = i.key.startsWith('w:')
    uses.push(useOf(i, 'de', writes ? 'out' : 'in', writes ? 'writes' : 'reads', { ent: /ENT/.test(i.badges?.[0]?.text || '') }))
  }
  const focus = { id: `focus:activity:${target.activityObjectId}`, type: activityMapType(target.typeId), label: target.name || 'Activity', sub: 'Activity · checked' }
  return { sections, map: mapInput({ focus, sections, uses }) }
}

// ── One automation: what it touches ───────────────────────
async function analyseAutomation(target, ctx) {
  const { stack } = ctx
  ctx.stage('automation', { state: 'running', done: 0, total: 1 })
  const auto = await sfmcFetch(`${AS(stack)}/automation/v1/automations/${encodeURIComponent(target.id)}`, 'GET')
  ctx.stage('automation', { state: 'done', done: 1, total: 1 })
  const acts = (auto?.steps || []).flatMap((s, si) => (s.activities || []).map((a) => ({ ...a, step: s.step ?? si + 1 })))
  const details = new Map()
  ctx.stage('activities', { state: 'running', done: 0, total: acts.length })
  await runInBatches(acts, 10, async (a) => {
    const url = activityEndpoint(stack, a)
    details.set(a, url ? await sfmcFetch(url, 'GET').catch(() => null) : null)
  }, { shouldStop: ctx.stop, onProgress: (d, t) => ctx.stage('activities', { state: 'running', done: d, total: t }) })
  ctx.checkStop()
  ctx.stage('activities', { state: 'done', done: acts.length, total: acts.length })

  const reads = new Map()
  const writes = new Map()
  const files = []
  const emails = []
  const other = []
  const add = (map, name, how, step, extra = {}) => {
    if (!name) return
    const k = norm(name)
    const e = map.get(k) || { name, how: new Set(), steps: new Set(), ...extra }
    e.how.add(how); e.steps.add(step)
    map.set(k, e)
  }
  // A DE named only by key (DataExtension.Init, data extracts): its name when a cached
  // Query activity targets it, else the key.
  const known = ctx.peek('queries')?.items || []
  const byKey = (key) => {
    const q = known.find((x) => norm(x.targetKey) === norm(key))
    return q?.targetName ? { name: q.targetName, key, id: q.targetId } : { name: `${key} (key)`, key, keyOnly: true }
  }
  const addByKey = (map, key, how, step) => {
    if (!key) return
    const r = byKey(key)
    add(map, r.name, how, step, { key: r.key, id: r.id, keyOnly: r.keyOnly })
  }
  let entryEvents = false
  for (const a of acts) {
    const d = details.get(a) || {}
    const t = Number(a.objectTypeId)
    if (t === 300) {
      for (const tb of tablesInSql(d.queryText)) add(reads, tb.name, `query ${d.name || a.name}`, a.step)
      add(writes, d.targetName, `query ${d.name || a.name}${d.targetUpdateTypeName ? ` (${d.targetUpdateTypeName})` : ''}`, a.step, { key: d.targetKey, id: d.targetId })
    } else if (t === 43) {
      add(writes, d.targetDataExtension?.name || d.destinationName, `import ${d.name || a.name}`, a.step)
      files.push({ step: a.step, text: `Import ${d.name || a.name}: ${d.fileNamingPattern || d.fileSpec || 'file'}${d.fileTransferLocationId ? ` (location ${d.fileTransferLocationId})` : ''}` })
    } else if (t === 303) {
      add(reads, d.sourceObjectName, `filter ${d.name || a.name}`, a.step)
      add(writes, d.resultDEName || d.destinationObjectName, `filter ${d.name || a.name}`, a.step)
    } else if (t === 73) {
      const key = (d.dataFields || []).find((f) => /^DECustomerKey$/i.test(f?.name))?.value
      addByKey(reads, key, `extract ${d.name || a.name}`, a.step)
      files.push({ step: a.step, text: `Data extract ${d.name || a.name}: ${d.fileSpec || 'file'}` })
    } else if (t === 53) {
      files.push({ step: a.step, text: `File transfer ${d.name || a.name}: ${d.fileSpec || 'file'}${d.fileTransferLocationId ? ` (location ${d.fileTransferLocationId})` : ''}` })
    } else if (t === 423) {
      for (const r of deRefsInCode(d.script)) {
        if (r.by === 'key') addByKey(reads, r.ref, `script ${d.name || a.name} (named in code)`, a.step)
        else add(reads, r.ref, `script ${d.name || a.name} (named in code)`, a.step)
      }
    } else if (t === 42) {
      emails.push({ step: a.step, name: d.name || a.name, subject: d.emailSubject || '' })
    } else if (t === 952) {
      entryEvents = true
      other.push({ step: a.step, text: `Journey entry: ${a.name || 'journey'}` })
    } else {
      other.push({ step: a.step, text: `${activityTypeLabel(t)}: ${a.name || ''}` })
    }
  }
  const deItems = (map, tone, verb) => [...map.values()].sort((x, y) => x.name.localeCompare(y.name)).map((e) => ({
    key: `${verb}:${e.name}`, kind: 'Data extension', title: e.name, badges: [{ text: verb, tone }],
    lines: [`Step ${[...e.steps].join(', ')}: ${[...e.how].join('; ')}`], pivot: e.keyOnly ? null : { kind: 'de', de: { name: e.name, customerKey: e.key, id: e.id } },
  }))
  const sections = [
    section('writes', 'Data extensions written', deItems(writes, 'write', 'Writes')),
    section('reads', 'Data extensions read', deItems(reads, 'read', 'Reads')),
    section('files', 'Files', files.map((f, i) => ({ key: `f${i}`, kind: 'File', title: f.text, badges: [], lines: [`Step ${f.step}`] }))),
    section('emails', 'Emails sent', emails.map((e, i) => ({ key: `m${i}`, kind: 'Send Email', title: e.name, badges: [], lines: [`Step ${e.step}`, e.subject ? `Subject: ${e.subject}` : ''].filter(Boolean) }))),
  ]
  if (entryEvents) {
    const events = await ctx.get('events')
    const evs = (events?.items || []).filter((e) => norm(e.automationId) === norm(target.id))
    sections.push(section('events', 'Journey entry events it fires', evs.map((e) => ({
      key: `e:${e.id}`, kind: 'Entry event', title: e.name || e.eventDefinitionKey, badges: [], lines: [`Data extension: ${e.dataExtensionName || ''}`], pivot: { kind: 'event', event: e },
    })), { source: events }))
  }
  sections.push(section('other', 'Other steps', other.map((o, i) => ({ key: `o${i}`, kind: 'Activity', title: o.text, badges: [], lines: [`Step ${o.step}`] })), { empty: 'None.' }))
  for (const x of sections) for (const i of x.items) i.mapNote = /^Steps? [\d, ]+/.exec(i.lines?.[0] || '')?.[0]?.trim() || ''
  const focus = { id: `focus:automation:${target.id}`, type: 'automation', label: auto?.name || target.name || 'Automation', sub: ['Automation', statusWords(auto?.status)].filter(Boolean).join(' · ') + ' · checked' }
  const uses = usesBySection(sections, {
    writes: ['de', 'out', 'writes'], reads: ['de', 'in', 'reads'], files: ['file', 'out', 'file'], emails: ['send', 'out', 'sends'], events: ['journey-event', 'out', 'entry'], other: ['step', 'out', 'runs'],
  })
  return { sections, title: auto?.name, map: mapInput({ focus, sections, uses }) }
}

// ── Journey entry event ───────────────────────────────────
async function analyseEvent(target, ctx) {
  const e = target.event
  const sections = []
  sections.push(section('source', 'Entry source', e.dataExtensionName ? [{
    key: 'de', kind: 'Data extension', title: e.dataExtensionName, badges: [{ text: 'Entry source', tone: 'read' }], lines: [], pivot: { kind: 'de', de: { id: e.dataExtensionId, name: e.dataExtensionName } },
  }] : [], { empty: 'No data extension (an API or Salesforce event, for example).' }))
  const automationId = eventAutomationId(e)
  if (automationId) {
    // Its name (live test, 2026-11-07: the ID was shown); the ID when it can't be read.
    const auto = await sfmcFetch(`${AS(ctx.stack)}/automation/v1/automations/${encodeURIComponent(automationId)}`, 'GET').catch(() => null)
    sections.push(section('automation', 'Automation that fires it', [{
      key: 'au', kind: 'Automation', title: auto?.name || `Automation ${automationId}`, badges: auto?.status ? [{ text: auto.status, tone: 'status' }] : [], automationId,
      lines: auto?.name ? [`ID ${automationId}`] : ['Its name could not be read.'], route: `/automations/${encodeURIComponent(automationId)}`,
    }]))
  }
  const journeys = await ctx.get('journeys')
  const items = (journeys?.items || []).filter((j) => (j.triggers || []).some((t) =>
    norm(t.metaData?.eventDefinitionKey || t.configurationArguments?.eventDefinitionKey) === norm(e.eventDefinitionKey) ||
    findValues(t, [e.id, e.eventDefinitionKey]).length)).map((j) => [j, []])
  sections.push(section('journeys', 'Journeys', journeyItems(items), { source: journeys }))
  const focus = { id: `focus:event:${e.id}`, type: 'event', label: e.name || e.eventDefinitionKey, sub: 'Entry event · checked' }
  return { sections, map: mapInput({ focus, sections, uses: usesBySection(sections, { source: ['de', 'in', 'entry'], automation: ['automation', 'in', 'runs'], journeys: ['journey', 'out', 'entry'] }) }) }
}

// ── Email ─────────────────────────────────────────────────
async function analyseEmail(target, ctx) {
  const a = target.asset
  const legacy = a.data?.email?.legacy?.legacyId ?? a.legacyId ?? null
  const ids = [legacy, a.id].filter((x) => x != null)
  const sections = []
  const journeys = await ctx.get('journeys')
  const items = []
  for (const j of journeys?.items || []) {
    const hits = (j.activities || []).filter((x) => findValues(x.configurationArguments || x, ids, /email/i).length)
    if (hits.length) items.push([j, [`In ${hits.map((x) => x.name || 'an email activity').join(', ')}`]])
  }
  sections.push(section('journeys', 'Journeys', journeyItems(items), { source: journeys }))
  const sends = await ctx.get('emailsends')
  const sendItems = (sends?.items || []).filter((s) => findValues(s.definition, ids, /email/i).length)
    .map((s) => ({ key: `42:${s.activityObjectId}`, kind: 'Send Email activity', title: s.name || 'Send Email', badges: [], lines: [], activityObjectId: s.activityObjectId }))
  sections.push(section('sends', 'Send Email activities', sendItems, { source: sends }))
  await attachAutomations(ctx, sections)
  const focus = { id: `focus:asset:${a.id}`, type: 'content', label: a.name || 'Email', sub: 'Email · checked' }
  return {
    sections,
    note: legacy == null ? 'This email has no legacy email ID, so journeys may not be matched.' : '',
    map: mapInput({ focus, sections, uses: usesBySection(sections, { journeys: ['journey', 'out', 'sends'], sends: ['send', 'out', 'sends'] }) }),
  }
}

// ── Content block ─────────────────────────────────────────
async function analyseBlock(target, ctx) {
  const b = target.asset
  const assets = await ctx.get('assets')
  const byGroup = {}
  for (const a of assets?.items || []) {
    if (String(a.id) === String(b.id)) continue
    const how = contentBlockRefs(assetText(a), b)
    if (assetPlacesBlock(a, b.id)) how.push('Placed in a slot')
    if (!how.length) continue
    ;(byGroup[assetGroup(a)] = byGroup[assetGroup(a)] || []).push(assetItem(a, [how.join(', ')], [{ text: 'Uses it', tone: 'read' }]))
  }
  const sections = Object.keys(GROUP_TITLES).filter((g) => byGroup[g]).map((g) => section(g, GROUP_TITLES[g], byGroup[g]))
  if (!sections.length) sections.push(section('content', 'Emails, templates, content blocks and CloudPages', [], { source: assets }))
  if (sections[0] && assets?.capped) sections[0].note = 'Only the newest 5,000 items were checked.'
  const focus = { id: `focus:asset:${b.id}`, type: 'content', label: b.name || 'Content block', sub: 'Content block · checked' }
  const rules = Object.fromEntries([...Object.keys(GROUP_TITLES), 'content'].map((g) => [g, ['content', 'out', 'uses']]))
  return { sections, map: mapInput({ focus, sections, uses: usesBySection(sections, rules) }) }
}

// ── File location ─────────────────────────────────────────
async function analyseLocation(target, ctx) {
  const loc = target.location
  const same = (x) => x != null && norm(x) === norm(loc.id)
  const imports = await ctx.get('imports')
  const transfers = await ctx.get('filetransfers')
  const sections = [
    section('imports', 'Import activities', (imports?.items || []).filter((i) => same(i.fileTransferLocationId))
      .map((i) => activityItem(ctx.stack, 43, i, { lines: [i.fileNamingPattern || i.fileSpec ? `File: ${i.fileNamingPattern || i.fileSpec}` : '', `Into ${i.targetDataExtension?.name || i.destinationName || i.destinationObjectId || '?'}`].filter(Boolean) })), { source: imports }),
    section('transfers', 'File Transfer activities', (transfers?.items || []).filter((f) => same(f.fileTransferLocationId))
      .map((f) => activityItem(ctx.stack, 53, f, { badges: [{ text: f.isUpload ? 'Upload' : 'Download', tone: 'info' }], lines: [f.fileSpec ? `File: ${f.fileSpec}` : ''].filter(Boolean) })), { source: transfers }),
  ]
  await attachAutomations(ctx, sections)
  const focus = { id: `focus:location:${loc.id}`, type: 'location', label: loc.name || loc.id, sub: 'File location · checked' }
  return { sections, map: mapInput({ focus, sections, uses: usesBySection(sections, { imports: ['import', 'out', 'file'], transfers: ['transfer', 'out', 'file'] }) }) }
}

// ── Profiles and send classifications ─────────────────────
const PROFILE_KEYS = {
  sender: /^senderProfile(Id|ID|Key)?$/i,
  delivery: /^deliveryProfile(Id|ID|Key)?$/i,
  classification: /^sendClassification(Id|ID|Key)?$/i,
}
export const PROFILE_LABELS = { sender: 'Sender profiles', delivery: 'Delivery profiles', classification: 'Send classifications' }

async function analyseProfiles(target, ctx) {
  const keyRe = PROFILE_KEYS[target.profileType]
  const groups = new Map() // id → { id, name, items }
  const put = (ref, item) => {
    const g = groups.get(norm(ref.id)) || { id: ref.id, name: '', items: [] }
    if (ref.name && !g.name) g.name = ref.name
    if (!g.items.some((i) => i.key === item.key)) g.items.push(item)
    groups.set(norm(ref.id), g)
  }
  const journeys = await ctx.get('journeys')
  const journeyRefs = new Map() // profile id → { ref, matches }
  for (const j of journeys?.items || []) {
    for (const ref of collectProfileRefs(j.activities, keyRe)) {
      const e = journeyRefs.get(norm(ref.id)) || { ref, matches: [] }
      if (!e.matches.some(([x]) => x === j)) e.matches.push([j, []])
      journeyRefs.set(norm(ref.id), e)
    }
  }
  for (const { ref, matches } of journeyRefs.values()) for (const item of journeyItems(matches)) put(ref, item)
  const sends = await ctx.get('emailsends')
  const sendItems = []
  for (const s of sends?.items || []) {
    const item = { key: `42:${s.activityObjectId}`, kind: 'Send Email activity', title: s.name || 'Send Email', badges: [], lines: [], activityObjectId: s.activityObjectId }
    const refs = collectProfileRefs(s.definition, keyRe)
    if (refs.length) sendItems.push(item)
    for (const ref of refs) put(ref, item)
  }
  const sections = [...groups.values()].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map((g) => section(`p:${g.id}`, g.name ? `${g.name} (${g.id})` : g.id, g.items))
  if (!sections.length) sections.push(section('none', PROFILE_LABELS[target.profileType], [], { empty: 'None found in journeys or Send Email activities.' }))
  await attachAutomations(ctx, sections)
  const real = sections.filter((x) => x.id.startsWith('p:'))
  const hubs = real.map((x) => ({ id: x.id, type: 'profile', label: x.title, sub: PROFILE_LABELS[target.profileType].replace(/s$/, '') }))
  const uses = real.flatMap((x) => x.items.map((i) => useOf(i, i.key.startsWith('j:') ? 'journey' : 'send', 'out', 'uses', { hub: x.id, label: '' })))
  const focus = { id: `focus:profiles:${target.profileType}`, type: 'profile', label: PROFILE_LABELS[target.profileType], sub: 'Checked' }
  return { sections, note: 'Profiles are listed by the ID that journeys and Send Email activities store; SFMC gives no name for most of them here.', map: mapInput({ focus, sections, uses, hubs }) }
}

// ── Map helpers ───────────────────────────────────────────
/**
 * Uses for the map, one per item, by section: rules is { sectionId: [type, dir, rel] }.
 * The type 'journey-event' is an entry event (type event).
 */
function usesBySection(sections, rules) {
  const uses = []
  for (const x of sections) {
    const r = rules[x.id]
    if (!r) continue
    const [type, dir, rel] = r
    for (const i of x.items || []) uses.push(useOf(i, type === 'journey-event' ? 'event' : type, dir, rel))
  }
  return uses
}

// ── Registry ──────────────────────────────────────────────
export const KINDS = {
  de: {
    label: 'Data extension',
    title: (t) => t.de.name,
    stages: (t) => (t.de.dataView
      ? [stage('queries'), stage('automations'), ANALYSE]
      : [stage('queries'), stage('imports'), stage('filters'), stage('dataextracts'), stage('scripts'), stage('automations'), stage('emailsends'), stage('events'), stage('journeys'), stage('assets'), ANALYSE]),
    analyze: analyseDE,
  },
  field: {
    label: 'Field',
    title: (t) => `${t.de.name}.${t.field}`,
    stages: (t) => (t.de.dataView ? [stage('queries'), stage('automations'), ANALYSE] : [stage('queries'), stage('journeys'), stage('assets'), stage('automations'), ANALYSE]),
    analyze: analyseField,
  },
  activity: {
    label: 'Activity',
    title: (t) => t.name || 'Activity',
    stages: () => [stage('automations'), ANALYSE],
    analyze: analyseActivity,
  },
  automation: {
    label: 'Automation',
    title: (t) => t.name || 'Automation',
    stages: () => [{ id: 'automation', label: 'Loading the automation' }, { id: 'activities', label: 'Loading each activity' }, stage('events'), ANALYSE],
    analyze: analyseAutomation,
  },
  event: {
    label: 'Journey entry event',
    title: (t) => t.event.name || t.event.eventDefinitionKey,
    stages: () => [stage('journeys'), ANALYSE],
    analyze: analyseEvent,
  },
  email: {
    label: 'Email',
    title: (t) => t.asset.name,
    stages: () => [stage('journeys'), stage('automations'), stage('emailsends'), ANALYSE],
    analyze: analyseEmail,
  },
  block: {
    label: 'Content block',
    title: (t) => t.asset.name,
    stages: () => [stage('assets'), ANALYSE],
    analyze: analyseBlock,
  },
  location: {
    label: 'File location',
    title: (t) => t.location.name || t.location.id,
    stages: () => [stage('imports'), stage('filetransfers'), stage('automations'), ANALYSE],
    analyze: analyseLocation,
  },
  profiles: {
    label: 'Profiles',
    title: (t) => PROFILE_LABELS[t.profileType],
    stages: () => [stage('journeys'), stage('automations'), stage('emailsends'), ANALYSE],
    analyze: analyseProfiles,
  },
}
