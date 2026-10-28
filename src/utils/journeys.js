// Journeys (Journey Builder interactions): list, one journey's definition, its canvas
// as a graph with a layout, and each node's content. Journey Builder is reached with
// its own session cookies; the service worker starts that session when needed.
//
// Not yet checked against a live org: the list filter (`nameOrDescription`), the
// detail call's `extras=all`, and the Journey Builder deep link format.
import { sfmcFetch } from './sfmcApi.js'
import { formatValue } from './activityTypes.js'
import { formatDateTime } from './format.js'
import { RESULTS_PAGE_SIZE } from './paging.js'

export const JOURNEY_PAGE_SIZE = RESULTS_PAGE_SIZE
const JB = (stack) => `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1`

export const JOURNEY_STATUSES = ['Draft', 'Published', 'ScheduledToPublish', 'Paused', 'Stopped', 'Unpublished', 'Deleted']

export async function searchJourneys(stack, { query = '', status = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    $page: String(page), $pageSize: String(JOURNEY_PAGE_SIZE), $orderBy: 'ModifiedDate DESC', mostRecentVersionOnly: 'true',
  })
  if (query.trim()) params.set('nameOrDescription', query.trim())
  if (status) params.set('status', status)
  const data = await sfmcFetch(`${JB(stack)}/interactions?${params}`, 'GET')
  const items = data?.items || []
  return { items, total: data?.count ?? items.length }
}

/**
 * One journey's definition. Some journeys answer 404 "Interaction matching criteria
 * not found" for the version the list gives; then the call is made again without
 * a version, which returns the latest one.
 */
export async function fetchJourney(stack, id, version) {
  const url = (v) => `${JB(stack)}/interactions/${encodeURIComponent(id)}?extras=all${v ? `&versionNumber=${encodeURIComponent(v)}` : ''}`
  try {
    return await sfmcFetch(url(version), 'GET')
  } catch (e) {
    if (!version || !(e.status === 404 || /matching criteria not found/i.test(e.message || ''))) throw e
    return sfmcFetch(url(null), 'GET')
  }
}

export function journeyBuilderUrl(stack, journey) {
  return `https://mc.${stack}.exacttarget.com/cloud/#app/Journey%20Builder/%23${encodeURIComponent(journey.id)}/${journey.version || 1}`
}

// ── Node types ─────────────────────────────────────────────
const TYPE_LABELS = {
  EMAILV2: 'Email', EMAIL: 'Email', SMSSYNC: 'SMS', SMS: 'SMS', PUSHNOTIFICATIONACTIVITY: 'Push notification',
  INAPPSYNCACTIVITY: 'In-app message', INBOXACTIVITY: 'Inbox message', WHATSAPPACTIVITY: 'WhatsApp',
  WAIT: 'Wait', WAITBYDURATION: 'Wait by duration', WAITBYATTRIBUTE: 'Wait by attribute', WAITUNTILDATE: 'Wait until date',
  WAITUNTILEVENT: 'Wait until event', STOWAIT: 'Einstein STO', MULTICRITERIADECISION: 'Decision split',
  RANDOMSPLIT: 'Random split', ENGAGEMENTSPLIT: 'Engagement split', ENGAGEMENTDECISION: 'Engagement split',
  ABNTEST: 'Path optimizer', EINSTEINSPLIT: 'Einstein split', UPDATECONTACTDATA: 'Update contact',
  CONTACTDECISION: 'Decision split', SALESCLOUDACTIVITY: 'Salesforce activity', SALESFORCESALESCLOUDACTIVITY: 'Salesforce activity',
  OBJECTACTIVITY: 'Salesforce activity', REST: 'Custom activity', EVENT: 'Event', JOIN: 'Join',
}
export const nodeTypeLabel = (type) => TYPE_LABELS[String(type || '').toUpperCase()] || (type ? String(type) : 'Activity')

export function nodeKind(type) {
  const t = String(type || '').toUpperCase()
  if (t === 'ENTRY') return 'entry'
  if (t === 'EXIT') return 'exit'
  if (/WAIT/.test(t)) return 'wait'
  if (/SPLIT|DECISION|ABNTEST/.test(t)) return 'split'
  if (/EMAIL|SMS|PUSH|INAPP|INBOX|WHATSAPP/.test(t)) return 'message'
  return 'action'
}

const ca = (a) => a?.configurationArguments || {}

/** One line about what a node does, for the canvas. */
export function nodeSummary(n) {
  // A canvas node (with `raw`) or the activity itself.
  const a = n.raw && n.type !== 'ENTRY' ? n.raw : n
  const t = String(a.type || '').toUpperCase()
  const c = ca(a)
  if (t === 'ENTRY') return a.eventDefinitionKey ? `Event ${a.eventDefinitionKey}` : nodeTypeLabel(a.triggerType)
  if (t === 'EMAILV2' || t === 'EMAIL') return c.triggeredSend?.emailSubject ? `Subject: ${c.triggeredSend.emailSubject}` : ''
  if (t === 'WAIT' || t === 'WAITBYDURATION') return c.waitDuration != null ? `${c.waitDuration} ${String(c.waitUnit || '').toLowerCase()}` : ''
  if (t === 'WAITUNTILDATE') return c.specifiedDateTime ? `Until ${formatDateTime(c.specifiedDateTime)}` : ''
  if (t === 'WAITBYATTRIBUTE') return c.attributeName || c.waitForAttribute || ''
  if (a.outcomes?.length > 1) return `${a.outcomes.length} paths`
  return ''
}

export function outcomeLabel(o, i) {
  const m = o?.metaData || {}
  const pct = o?.arguments?.percentage
  return m.label || m.pathName || o?.arguments?.branchResult || (pct != null ? `${pct}%` : '') || (i != null ? `Path ${i + 1}` : '')
}

// ── Graph ──────────────────────────────────────────────────
/**
 * Nodes and edges of a journey: the entry (trigger) first, then every activity.
 * An outcome's `next` names the activity it leads to; an outcome with no `next`
 * ends the path (shown as an exit node).
 */
export function journeyGraph(journey) {
  const activities = journey?.activities || []
  const byKey = new Map(activities.map((a) => [a.key, a]))
  const targets = new Set(activities.flatMap((a) => (a.outcomes || []).map((o) => o.next).filter(Boolean)))
  const trigger = journey?.triggers?.[0]
  const nodes = []
  const edges = []

  const entry = {
    key: '__entry', type: 'ENTRY', name: trigger?.name || 'Entry', triggerType: trigger?.type,
    eventDefinitionKey: trigger?.metaData?.eventDefinitionKey || trigger?.configurationArguments?.eventDefinitionKey || null,
    raw: trigger || null,
  }
  nodes.push(entry)
  // Roots: activities nothing leads to (normally just the first one).
  activities.filter((a) => !targets.has(a.key)).forEach((a) => edges.push({ from: entry.key, to: a.key, label: '' }))

  let exitCount = 0
  for (const a of activities) {
    nodes.push({ key: a.key, type: a.type, name: a.name || nodeTypeLabel(a.type), raw: a })
    const outs = a.outcomes || []
    const multi = outs.length > 1
    outs.forEach((o, i) => {
      const label = multi ? outcomeLabel(o, i) : ''
      if (o.next && byKey.has(o.next)) edges.push({ from: a.key, to: o.next, label })
      else {
        const key = `__exit${++exitCount}`
        nodes.push({ key, type: 'EXIT', name: 'Exit', raw: null })
        edges.push({ from: a.key, to: key, label })
      }
    })
    if (!outs.length) {
      const key = `__exit${++exitCount}`
      nodes.push({ key, type: 'EXIT', name: 'Exit', raw: null })
      edges.push({ from: a.key, to: key, label: '' })
    }
  }
  return { nodes, edges }
}

/**
 * Canvas positions like Journey Builder: depth along the flow, and a lane per path.
 * A node's first path stays in its lane; each further path takes the next free lane.
 * A node reached by several paths keeps the place of the first one.
 * Returns Map key → { depth, lane } and the canvas size in cells.
 */
export function layoutJourney({ nodes, edges }) {
  const children = new Map(nodes.map((n) => [n.key, []]))
  for (const e of edges) children.get(e.from)?.push(e.to)
  const pos = new Map()
  let nextLane = 0

  const place = (key, depth) => {
    if (pos.has(key)) return pos.get(key).lane
    pos.set(key, { depth, lane: -1 })
    const kids = children.get(key) || []
    let lane = -1
    kids.forEach((k, i) => {
      const fresh = !pos.has(k)
      const l = place(k, depth + 1)
      if (i === 0 || lane < 0) lane = fresh ? l : lane
    })
    if (lane < 0) lane = nextLane++
    pos.get(key).lane = lane
    return lane
  }
  if (nodes.length) place(nodes[0].key, 0)
  for (const n of nodes) if (!pos.has(n.key)) place(n.key, 0) // anything unreachable
  const depths = Math.max(0, ...[...pos.values()].map((p) => p.depth)) + 1
  return { pos, depths, lanes: Math.max(1, nextLane) }
}

// ── Node content ───────────────────────────────────────────
const kvTable = (title, obj, extra = false) => (obj && typeof obj === 'object' && Object.keys(obj).length
  ? { title, columns: ['Property', 'Value'], rows: Object.entries(obj).map(([k, v]) => [k, formatValue(v)]), extra }
  : null)

// Readable settings (feedback #42): labels in words, and IDs, keys and enum codes
// moved to the extra rows so the main list reads like Journey Builder.
const SETTING_LABELS = {
  isOptIn: 'Opt-in message', honorBlackoutWindowEnum: 'Blackout window', mobileBlackoutWindowStartTime: 'Blackout from',
  mobileBlackoutWindowEndTime: 'Blackout until', isUsingDEAttributesForPersonalization: 'Personalize with journey data',
  isConcatenate: 'Join long messages', shortLinks: 'Short links', fromName: 'From name', isFromNameCertificationAccepted: 'From name certified',
  googleCampaignName: 'Google Analytics campaign', description: 'Description',
}
const TECHNICAL_SETTING = /(Id|Ids|ID|Key|Guid|Enum)$|^(application|definition|reporting|campaign)/
export const settingLabel = (k) => SETTING_LABELS[k] || String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  .replace(/^is /i, '').toLowerCase().replace(/^./, (c) => c.toUpperCase())

/** { main, extra } rows for a settings object: readable ones first, the rest (and empty ones) extra. */
export function settingsRows(obj) {
  const main = []
  const extra = []
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && typeof v === 'object') { extra.push([settingLabel(k), formatValue(v)]); continue }
    const value = formatValue(v)
    const technical = TECHNICAL_SETTING.test(k) && !SETTING_LABELS[k]
    ;(technical || value === '—' ? extra : main).push([settingLabel(k), value])
  }
  return { main, extra }
}

// ── Decision criteria ──────────────────────────────────────
const OPERATORS = {
  Equal: 'equals', NotEqual: 'is not', GreaterThan: 'is greater than', LessThan: 'is less than',
  GreaterThanOrEqual: 'is at least', LessThanOrEqual: 'is at most', Contains: 'contains', DoesNotContain: 'does not contain',
  BeginsWith: 'begins with', EndsWith: 'ends with', IsNull: 'is empty', IsNotNull: 'is not empty', Is: 'is', IsNot: 'is not',
  Between: 'is between', In: 'is one of', NotIn: 'is not one of',
}

/**
 * Journey Builder decision criteria (FilterDefinition XML) as readable text, e.g.
 * 'Country equals "CA" AND Age is at least "18"'. Returns the input when it can't be read.
 */
export function describeCriteria(xml) {
  if (!xml || typeof xml !== 'string' || !xml.includes('<')) return xml || ''
  let doc
  try { doc = new DOMParser().parseFromString(xml, 'application/xml') } catch { return xml }
  if (!doc || doc.getElementsByTagName('parsererror').length) return xml
  const text = (el) => {
    if (!el) return ''
    if (el.tagName === 'Condition') {
      const key = (el.getAttribute('Key') || '').split('.').pop()
      const op = el.getAttribute('Operator') || ''
      const values = [...el.getElementsByTagName('Value')].map((v) => `"${v.textContent.trim()}"`)
      return [key, OPERATORS[op] || op, values.join(' and ')].filter(Boolean).join(' ')
    }
    const parts = [...el.children].filter((c) => c.tagName === 'Condition' || c.tagName === 'ConditionSet').map(text).filter(Boolean)
    const joined = parts.join(` ${(el.getAttribute('Operator') || 'AND').toUpperCase()} `)
    return el.tagName === 'ConditionSet' && parts.length > 1 && el.parentElement?.tagName === 'ConditionSet' ? `(${joined})` : joined
  }
  const root = doc.documentElement
  const top = root.tagName === 'ConditionSet' ? root : root.getElementsByTagName('ConditionSet')[0] || root
  return text(top) || xml
}

/**
 * Display data for ActivityCard (see utils/activityTypes.js). `nameOf(key)` names
 * the step a path leads to.
 */
export function describeJourneyNode(node, nameOf = (k) => k) {
  const a = node.raw || {}
  const t = String(node.type || '').toUpperCase()
  const c = ca(a)
  const main = []
  const extra = [['Key', formatValue(a.key ?? node.key)], ['ID', formatValue(a.id)]]
  let code = null
  const tables = []
  let deRefs = {}

  if (t === 'ENTRY') {
    main.push(['Entry type', nodeTypeLabel(a.type) || formatValue(a.type)], ['Event definition key', formatValue(node.eventDefinitionKey)])
    // The entry data extension, where the trigger names it (field names not checked live; feedback #72).
    const deName = a.metaData?.dataExtensionName || a.configurationArguments?.dataExtensionName || a.arguments?.dataExtensionName
    if (typeof deName === 'string' && deName.trim()) {
      main.push(['Data extension', deName])
      deRefs = { 'Data extension': { name: deName, id: a.metaData?.dataExtensionId || a.configurationArguments?.dataExtensionId || null, key: null } }
    }
    tables.push(kvTable('Entry settings', a.configurationArguments), kvTable('Entry details', a.metaData, true), kvTable('Arguments', a.arguments, true))
  } else if (t === 'EXIT') {
    main.push(['', 'Contacts leave the journey here.'])
  } else if (t === 'EMAILV2' || t === 'EMAIL') {
    const ts = c.triggeredSend || {}
    main.push(['Email', formatValue(ts.emailName || a.metaData?.emailName || a.name)], ['Subject', formatValue(ts.emailSubject)],
      ['Preheader', formatValue(ts.preHeader)], ['Email ID', formatValue(ts.emailId)], ['Send classification', formatValue(ts.sendClassificationId)],
      ['Sender profile', formatValue(ts.senderProfileId)], ['Delivery profile', formatValue(ts.deliveryProfileId)])
    tables.push(kvTable('Send settings', ts, true))
  } else if (/WAIT/.test(t)) {
    if (c.waitDuration != null) main.push(['Wait', `${c.waitDuration} ${String(c.waitUnit || '').toLowerCase()}`])
    if (c.specifiedDateTime) main.push(['Until', formatDateTime(c.specifiedDateTime)])
    if (c.timeZone || c.timezone) main.push(['Time zone', formatValue(c.timeZone || c.timezone)])
    if (c.waitEndDateAttributeExpression || c.attributeName) main.push(['Attribute', formatValue(c.waitEndDateAttributeExpression || c.attributeName)])
    tables.push(kvTable('Wait settings', c, true))
  } else {
    // SMS and every other type: readable settings, technical ones under additional details.
    if (t === 'SMSSYNC' || t === 'SMS') main.push(['Message', formatValue(a.metaData?.messageName || c.messageName || a.name || node.name)])
    const rows = settingsRows(c)
    main.push(...rows.main)
    extra.push(...rows.extra)
  }

  // Paths of a split or decision, with their criteria.
  const outs = a.outcomes || []
  if (outs.length > 1) {
    tables.push({
      title: 'Paths', columns: ['Path', 'Criteria or share', 'Leads to'],
      rows: outs.map((o, i) => [
        outcomeLabel(o, i),
        o.arguments?.criteria ? describeCriteria(o.arguments.criteria) : o.arguments?.percentage != null ? `${o.arguments.percentage}%` : formatValue(o.arguments?.branchResult ?? ''),
        o.next ? nameOf(o.next) : 'Exit',
      ]),
    })
    const criteria = outs.map((o, i) => (o.arguments?.criteria ? `-- ${outcomeLabel(o, i)}\n${o.arguments.criteria}` : null)).filter(Boolean)
    if (criteria.length) tables.push({ title: 'Criteria as defined (XML)', columns: ['Value'], rows: [[criteria.join('\n\n')]], extra: true })
  }
  if (a.arguments && t !== 'ENTRY') tables.push(kvTable('Arguments', a.arguments, true))
  if (a.metaData && t !== 'ENTRY') tables.push(kvTable('Details', a.metaData, true))

  return {
    typeLabel: t === 'ENTRY' ? 'Entry' : t === 'EXIT' ? 'Exit' : nodeTypeLabel(a.type),
    title: node.name,
    link: null,
    main: main.filter(([, v]) => v !== '—'),
    extra,
    deRefs,
    code,
    tables: tables.filter(Boolean),
  }
}

/** The legacy email ID of an email node, used to find its Content Builder asset. */
export const nodeEmailId = (node) => ca(node.raw).triggeredSend?.emailId ?? null

/** Content Builder asset of a journey email, found by its legacy email ID (or null). */
export async function fetchJourneyEmailAsset(stack, emailId) {
  const data = await sfmcFetch(`https://content-builder.${stack}.marketingcloudapps.com/fuelapi/asset/v1/content/assets/query`, 'POST', {
    page: { page: 1, pageSize: 1 },
    query: { property: 'data.email.legacy.legacyId', simpleOperator: 'equal', value: Number(emailId) },
    fields: ['id', 'name', 'views', 'content', 'superContent', 'design', 'slots', 'blocks', 'meta', 'assetType'],
  })
  return data?.items?.[0] || null
}

// ── Export ─────────────────────────────────────────────────
export function journeyOverviewRows(j) {
  return [
    ['Name', j.name], ['Status', j.status], ['Version', j.version], ['Key', j.key], ['Description', j.description],
    ['Entry mode', j.entryMode], ['Created', formatDateTime(j.createdDate)], ['Modified', formatDateTime(j.modifiedDate)],
    ['Last published', formatDateTime(j.lastPublishedDate)], ['ID', j.id],
  ].filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
}

export function journeyDoc(journey, graph, layout, diagram = null) {
  const ordered = [...graph.nodes].filter((n) => n.type !== 'EXIT')
    .sort((a, b) => (layout.pos.get(a.key)?.lane - layout.pos.get(b.key)?.lane) || (layout.pos.get(a.key)?.depth - layout.pos.get(b.key)?.depth))
  const blocks = [{ type: 'h', level: 2, text: 'Overview' }, { type: 'kv', rows: journeyOverviewRows(journey) },
    // The canvas as a drawing (feedback #1009), passed in as an SVG string.
    ...(diagram ? [{ type: 'h', level: 2, text: 'Journey' }, { type: 'svg', svg: diagram, note: 'Journey diagram: in the HTML and PDF downloads.' }] : []),
    { type: 'h', level: 2, text: 'Steps' }]
  const nameOf = (k) => graph.nodes.find((x) => x.key === k)?.name || k
  for (const n of ordered) {
    const d = describeJourneyNode(n, nameOf)
    const next = graph.edges.filter((e) => e.from === n.key).map((e) => {
      const to = graph.nodes.find((x) => x.key === e.to)
      return `${e.label ? `${e.label}: ` : ''}${to?.type === 'EXIT' ? 'Exit' : to?.name || e.to}`
    })
    blocks.push({ type: 'h', level: 3, text: `${d.typeLabel}: ${d.title}` },
      { type: 'kv', rows: [...d.main, ...d.extra, ['Next', next.join('; ') || 'Exit']] },
      ...(d.code ? [{ type: 'code', text: d.code.text }] : []),
      ...d.tables.flatMap((t) => [{ type: 'p', text: t.title }, { type: 'table', columns: t.columns, rows: t.rows }]))
  }
  for (const [title, list] of [['Goals', journey.goals], ['Exit criteria', journey.exits]]) {
    if (list?.length) blocks.push({ type: 'h', level: 2, text: title }, { type: 'code', text: JSON.stringify(list, null, 2) })
  }
  return { title: journey.name || 'Journey', blocks }
}
