// Tracking events across a business unit (user, 2026-11-16; ideas from VeLens's Error Log,
// Send Details and Engagement Hub, our own code). Read-only SOAP Retrieve:
// - BounceEvent, NotSentEvent (send problems), UnsubEvent, ForwardedEmailEvent,
//   ForwardedEmailOptInEvent, SMSMOEvent (engagement), by EventDate;
// - ListSend, NotSentEvent and UnsubEvent of one send (JobID).
// Objects and properties checked live on s10 (Mathes Sandbox), 2026-11-16: all accepted;
// SMSMOEvent only answers EventDate, MOCode and Carrier (no phone number or subscriber).
// Event volumes can be large, so feeds read at most FEED_PAGES pages (2,500 rows each) and
// say when SFMC had more.
import { soapRetrieveAll } from './soapApi.js'

export const FEED_DAYS = [1, 7, 30]
export const FEED_PAGES = 4 // 10,000 events
const num = (v) => (v == null || v === '' ? null : Number(v))
const opts = (retrieve) => (retrieve ? { retrieve } : {})
const since = (days, now) => ({ property: 'EventDate', operator: 'greaterThan', values: [new Date(now - days * 86400000).toISOString().slice(0, 19)], dates: true })
const newestFirst = (a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
const bySend = (jobId) => ({ property: 'SendID', operator: 'equals', values: [String(Number(jobId))] })

/** { rows, capped } of one event type since `days` ago. */
async function feed(stack, objectType, properties, map, { days = 7, now = Date.now(), retrieve } = {}) {
  const raw = await soapRetrieveAll(stack, objectType, properties, { filter: since(days, now), pageLimit: FEED_PAGES, ...opts(retrieve) })
  return { rows: raw.map(map).sort(newestFirst), capped: !!raw.capped }
}

// ── Send problems ─────────────────────────────────────────
export const bounceRow = (b) => ({
  sendId: num(b.SendID), subscriberKey: b.SubscriberKey || '', eventDate: b.EventDate || '',
  category: b.BounceCategory || '', type: b.BounceType || '', smtpCode: b.SMTPCode || '', smtpReason: b.SMTPReason || '',
})
export const fetchBounceFeed = (stack, o) => feed(stack, 'BounceEvent', ['SendID', 'SubscriberKey', 'EventDate', 'BounceCategory', 'BounceType', 'SMTPCode', 'SMTPReason'], bounceRow, o)

export const notSentRow = (n) => ({
  sendId: num(n.SendID), subscriberKey: n.SubscriberKey || '', eventDate: n.EventDate || '', eventType: n.EventType || '',
  listId: num(n.ListID), batchId: num(n.BatchID), triggeredSendId: n.TriggeredSendDefinitionObjectID || '',
})
const NOT_SENT_PROPS = ['SendID', 'SubscriberKey', 'EventDate', 'EventType', 'ListID', 'BatchID', 'TriggeredSendDefinitionObjectID']
export const fetchNotSentFeed = (stack, o) => feed(stack, 'NotSentEvent', NOT_SENT_PROPS, notSentRow, o)

/**
 * Bounces grouped by category and SMTP code, most first, with one sample reason and how
 * many sends and subscribers each touched.
 */
export function groupBounces(rows) {
  const groups = new Map()
  for (const r of rows) {
    const k = `${r.category}\u0000${r.smtpCode}`
    const g = groups.get(k) || { category: r.category || 'Unknown', smtpCode: r.smtpCode, count: 0, reason: '', sends: new Set(), subscribers: new Set(), last: '' }
    g.count++
    if (!g.reason && r.smtpReason) g.reason = r.smtpReason
    if (r.sendId != null) g.sends.add(r.sendId)
    g.subscribers.add(r.subscriberKey)
    if (r.eventDate > g.last) g.last = r.eventDate
    groups.set(k, g)
  }
  return [...groups.values()].map((g) => ({ ...g, sends: g.sends.size, subscribers: g.subscribers.size })).sort((a, b) => b.count - a.count)
}

/** Sends with the most bounces (sendId, count, hard), most first. */
export function bouncesBySend(rows) {
  const m = new Map()
  for (const r of rows) {
    if (r.sendId == null) continue
    const g = m.get(r.sendId) || { sendId: r.sendId, count: 0, hard: 0 }
    g.count++
    if (/hard/i.test(`${r.category} ${r.type}`)) g.hard++
    m.set(r.sendId, g)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

/** Not-sent events by their EventType (SFMC's reason), most first. */
export function groupNotSent(rows) {
  const m = new Map()
  for (const r of rows) m.set(r.eventType || 'Not given', (m.get(r.eventType || 'Not given') || 0) + 1)
  return [...m.entries()].map(([eventType, count]) => ({ eventType, count })).sort((a, b) => b.count - a.count)
}

// ── One send ──────────────────────────────────────────────
const LIST_SEND_PROPS = ['SendID', 'List.ID', 'List.ListName', 'NumberSent', 'NumberDelivered', 'UniqueOpens', 'UniqueClicks', 'HardBounces', 'SoftBounces', 'OtherBounces',
  'Unsubscribes', 'ExistingUnsubscribes', 'ExistingUndeliverables', 'Duplicates', 'InvalidAddresses', 'MissingAddresses', 'ForwardedEmails']
export const listSendRow = (l) => {
  const n = (k) => num(l[k])
  return {
    listId: num(l.List?.ID), listName: l.List?.ListName || '', sent: n('NumberSent'), delivered: n('NumberDelivered'), uniqueOpens: n('UniqueOpens'), uniqueClicks: n('UniqueClicks'),
    bounces: (n('HardBounces') || 0) + (n('SoftBounces') || 0) + (n('OtherBounces') || 0), unsubscribes: n('Unsubscribes'),
    existingUnsubscribes: n('ExistingUnsubscribes'), existingUndeliverables: n('ExistingUndeliverables'), duplicates: n('Duplicates'),
    invalidAddresses: n('InvalidAddresses'), missingAddresses: n('MissingAddresses'), forwarded: n('ForwardedEmails'),
  }
}

/**
 * What one send went to and what went wrong: { lists, notSent, notSentByType, unsubscribes }.
 * Each part loads on its own; a part SFMC refuses comes back as { error } instead of rows.
 */
export async function fetchSendDetails(stack, jobId, { retrieve } = {}) {
  const part = (p) => p.then((rows) => ({ rows }), (e) => ({ error: e.message || String(e) }))
  const [lists, notSent, unsubs] = await Promise.all([
    part(soapRetrieveAll(stack, 'ListSend', LIST_SEND_PROPS, { filter: bySend(jobId), ...opts(retrieve) }).then((r) => r.map(listSendRow))),
    part(soapRetrieveAll(stack, 'NotSentEvent', NOT_SENT_PROPS, { filter: bySend(jobId), pageLimit: FEED_PAGES, ...opts(retrieve) }).then((r) => r.map(notSentRow).sort(newestFirst))),
    part(soapRetrieveAll(stack, 'UnsubEvent', ['SendID', 'SubscriberKey', 'EventDate', 'IsMasterUnsubscribed'], { filter: bySend(jobId), pageLimit: FEED_PAGES, ...opts(retrieve) })
      .then((r) => r.map(unsubRow).sort(newestFirst))),
  ])
  return { lists, notSent, notSentByType: notSent.rows ? groupNotSent(notSent.rows) : null, unsubscribes: unsubs }
}

// ── Engagement ────────────────────────────────────────────
export const unsubRow = (u) => ({ sendId: num(u.SendID), subscriberKey: u.SubscriberKey || '', eventDate: u.EventDate || '', master: u.IsMasterUnsubscribed === 'true' })
export const ENGAGEMENT_FEEDS = {
  unsubscribes: { label: 'Unsubscribes', object: 'UnsubEvent', props: ['SendID', 'SubscriberKey', 'EventDate', 'IsMasterUnsubscribed'], map: unsubRow },
  forwards: { label: 'Forwards', object: 'ForwardedEmailEvent', props: ['SendID', 'SubscriberKey', 'EventDate'], map: (f) => ({ sendId: num(f.SendID), subscriberKey: f.SubscriberKey || '', eventDate: f.EventDate || '' }) },
  optins: {
    label: 'Forward opt-ins', object: 'ForwardedEmailOptInEvent', props: ['SendID', 'SubscriberKey', 'EventDate', 'OptInSubscriberKey'],
    map: (f) => ({ sendId: num(f.SendID), subscriberKey: f.SubscriberKey || '', eventDate: f.EventDate || '', optInKey: f.OptInSubscriberKey || '' }),
  },
  sms: { label: 'Inbound SMS', object: 'SMSMOEvent', props: ['EventDate', 'MOCode', 'Carrier'], map: (m) => ({ eventDate: m.EventDate || '', moCode: m.MOCode || '', carrier: m.Carrier || '' }) },
}
export async function fetchEngagementFeed(stack, kind, o) {
  const f = ENGAGEMENT_FEEDS[kind]
  if (!f) throw new Error(`Unknown feed: ${kind}`)
  return feed(stack, f.object, f.props, f.map, o)
}

/** Events per day (YYYY-MM-DD → count), oldest first, for a small bar chart. */
export function perDay(rows) {
  const m = new Map()
  for (const r of rows) {
    const d = String(r.eventDate || '').slice(0, 10)
    if (d) m.set(d, (m.get(d) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }))
}
