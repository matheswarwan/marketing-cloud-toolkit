// Read-only contact lookups (user, 2026-11-10).
// - Subscriber lookup: SOAP Subscriber (All Subscribers), ListSubscriber + List, BounceEvent,
//   UnsubEvent and SentEvent for one subscriber key or email address. Properties and filters
//   checked live on s10 that day (ModifiedDate on Subscriber and ListID on BounceEvent are
//   not valid properties). The profile Attributes SFMC returns are never read or shown.
// - Contact deletions: REST contacts/v1 deleteOperations (checked live: { page, pageSize,
//   count, items }; item fields from SFMC's reference "Retrieve a List of Contact Deletion
//   Operations", read 2026-11-17, as the test account has no operations), the status of
//   one operation and the analytics summary (403 on s10; needs startdateutc and enddateutc).
// Nothing here changes SFMC data: deletions are started in Contact Builder.
import { sfmcFetch } from './sfmcApi.js'
import { soapRetrieveAll } from './soapApi.js'

const API = (stack) => `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi`
const enc = encodeURIComponent
const num = (v) => (v == null || v === '' ? null : Number(v))
const opts = (retrieve) => (retrieve ? { retrieve } : {})
const byKey = (key) => ({ property: 'SubscriberKey', operator: 'equals', values: [String(key)] })
const newestFirst = (a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
const PLACEHOLDER = /^0001-01-01/
const date = (v) => (v && !PLACEHOLDER.test(v) ? v : '')

/** An email address rather than a subscriber key (keys can hold '@' too; the page lets the user switch). */
export const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())

// ── All Subscribers ───────────────────────────────────────
const SUBSCRIBER_PROPS = ['ID', 'SubscriberKey', 'EmailAddress', 'Status', 'CreatedDate', 'UnsubscribedDate', 'EmailTypePreference']

/** Only the listed fields: the Attributes in the answer (profile data) are dropped. */
export function subscriberRow(s) {
  return {
    id: num(s.ID), key: s.SubscriberKey || '', email: s.EmailAddress || '', status: s.Status || '',
    createdDate: date(s.CreatedDate), unsubscribedDate: date(s.UnsubscribedDate), emailType: s.EmailTypePreference || '',
  }
}

/** Subscribers at All Subscribers by key (one at most) or email address (can be several). */
export async function fetchSubscribers(stack, { key = null, email = null, retrieve } = {}) {
  const filter = key != null ? byKey(key) : { property: 'EmailAddress', operator: 'equals', values: [String(email)] }
  const rows = await soapRetrieveAll(stack, 'Subscriber', SUBSCRIBER_PROPS, { filter, ...opts(retrieve) })
  return rows.map(subscriberRow)
}

/**
 * The subscriber in every business unit this login can see (user, 2026-11-16; idea from
 * VeLens): SOAP Subscriber with QueryAllAccounts gives one row per business unit, each
 * with its own Client.ID and status (live test, s10: subscriber 2 came back for all 33
 * business units; ClientIDs with every MID answered for the current one only). By key or
 * email address. `buNames`: Map MID -> name. Profile attributes are dropped as above.
 */
export async function fetchSubscriberAcrossBUs(stack, { key = null, email = null, buNames = new Map(), retrieve } = {}) {
  const filter = key != null ? byKey(key) : { property: 'EmailAddress', operator: 'equals', values: [String(email)] }
  const rows = await soapRetrieveAll(stack, 'Subscriber', [...SUBSCRIBER_PROPS, 'Client.ID'], { filter, queryAllAccounts: true, ...opts(retrieve) })
  return rows.map((s) => {
    const mid = num(s.Client?.ID)
    return { ...subscriberRow(s), mid, businessUnit: buNames.get(mid) || (mid ? `MID ${mid}` : '') }
  }).sort((a, b) => a.businessUnit.localeCompare(b.businessUnit) || a.key.localeCompare(b.key))
}

/** Statuses across business units in one line: "Active in 30, Unsubscribed in 3". */
export function statusSummary(rows) {
  const m = new Map()
  for (const r of rows) m.set(r.status || 'Unknown', (m.get(r.status || 'Unknown') || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([st, n]) => `${st} in ${n}`).join(', ')
}

// ── Lists ─────────────────────────────────────────────────
const LIST_SUB_PROPS = ['ListID', 'SubscriberKey', 'Status', 'CreatedDate', 'UnsubscribedDate']
const LIST_PROPS = ['ID', 'ListName', 'Type', 'ListClassification']

/** The subscriber's list memberships with each list's name (lists read only when there are memberships). */
export async function fetchListMemberships(stack, key, { retrieve } = {}) {
  const subs = await soapRetrieveAll(stack, 'ListSubscriber', LIST_SUB_PROPS, { filter: byKey(key), ...opts(retrieve) })
  if (!subs.length) return []
  const lists = await soapRetrieveAll(stack, 'List', LIST_PROPS, { filter: { property: 'ID', operator: 'greaterThan', values: ['0'] }, ...opts(retrieve) }).catch(() => [])
  const names = new Map(lists.map((l) => [num(l.ID), l]))
  return subs.map((s) => {
    const l = names.get(num(s.ListID)) || {}
    return {
      listId: num(s.ListID), listName: l.ListName || '', listType: l.Type || '', classification: l.ListClassification || '',
      status: s.Status || '', createdDate: date(s.CreatedDate), unsubscribedDate: date(s.UnsubscribedDate),
    }
  }).sort((a, b) => a.listName.localeCompare(b.listName))
}

// ── Tracking events ───────────────────────────────────────
export async function fetchBounces(stack, key, { retrieve } = {}) {
  const rows = await soapRetrieveAll(stack, 'BounceEvent', ['SendID', 'SubscriberKey', 'EventDate', 'BounceCategory', 'BounceType', 'SMTPCode', 'SMTPReason'], { filter: byKey(key), ...opts(retrieve) })
  return rows.map((b) => ({
    sendId: num(b.SendID), eventDate: b.EventDate || '', category: b.BounceCategory || '', type: b.BounceType || '', smtpCode: b.SMTPCode || '', smtpReason: b.SMTPReason || '',
  })).sort(newestFirst)
}

export async function fetchUnsubscribes(stack, key, { retrieve } = {}) {
  const rows = await soapRetrieveAll(stack, 'UnsubEvent', ['SendID', 'SubscriberKey', 'EventDate', 'IsMasterUnsubscribed'], { filter: byKey(key), ...opts(retrieve) })
  return rows.map((u) => ({ sendId: num(u.SendID), eventDate: u.EventDate || '', master: u.IsMasterUnsubscribed === 'true' })).sort(newestFirst)
}

export const RECENT_SENDS = 20
/** { total, rows }: the latest `limit` sends to this subscriber, newest first. */
export async function fetchRecentSends(stack, key, { retrieve, limit = RECENT_SENDS } = {}) {
  const rows = await soapRetrieveAll(stack, 'SentEvent', ['SendID', 'SubscriberKey', 'EventDate', 'TriggeredSendDefinitionObjectID'], { filter: byKey(key), ...opts(retrieve) })
  const all = rows.map((s) => ({ sendId: num(s.SendID), eventDate: s.EventDate || '', triggeredSendId: s.TriggeredSendDefinitionObjectID || '' })).sort(newestFirst)
  return { total: all.length, rows: all.slice(0, limit) }
}

/** A hard bounce by SFMC's category or type text ("Hard bounce", "Block bounce" counts as not hard). */
export const isHardBounce = (b) => /hard/i.test(`${b.category} ${b.type}`)

/**
 * Plain-English reasons this person may not get email, from what has loaded so far.
 * `facts`: { subscriber (row or null when not found), notFound, lists[], bounces[], unsubscribes[] };
 * a missing (undefined) part is skipped.
 */
export function whyNoEmail(facts, now = Date.now()) {
  const out = []
  const { subscriber, notFound, lists, bounces, unsubscribes } = facts || {}
  if (notFound) out.push('Not found at All Subscribers in this business unit. They have not been sent to or imported here, or the key or address is different (keys are matched exactly).')
  const status = subscriber?.status || ''
  if (/unsub/i.test(status)) out.push(`Unsubscribed at All Subscribers${subscriber.unsubscribedDate ? ` since ${subscriber.unsubscribedDate.slice(0, 10)}` : ''}: commercial sends skip them in every list and data extension. Transactional send classifications can still reach them.`)
  else if (/held/i.test(status)) out.push('Held at All Subscribers: SFMC stopped sending after repeated bounces. Sends skip them until the status is set back to Active.')
  else if (/bounced/i.test(status)) out.push('Bounced at All Subscribers: a recent send bounced. SFMC keeps trying, and holds them after more bounces.')
  else if (/deleted/i.test(status)) out.push('Deleted at All Subscribers.')
  const unsubLists = (lists || []).filter((l) => /unsub/i.test(l.status))
  if (unsubLists.length) out.push(`Unsubscribed from ${unsubLists.length === 1 ? 'the list' : `${unsubLists.length} lists`} ${unsubLists.map((l) => l.listName || `#${l.listId}`).join(', ')}: sends to ${unsubLists.length === 1 ? 'that list skip' : 'those lists skip'} them.`)
  const recent = (bounces || []).filter((b) => isHardBounce(b) && now - Date.parse(b.eventDate) < 90 * 86400000)
  if (recent.length) out.push(`${recent.length} hard ${recent.length === 1 ? 'bounce' : 'bounces'} in the last 90 days (latest: ${recent[0].smtpReason || recent[0].category || recent[0].type}).`)
  if ((unsubscribes || []).some((u) => u.master) && !/unsub/i.test(status)) out.push('An unsubscribe event says they unsubscribed from everything, though All Subscribers shows them as active now (they may have been resubscribed).')
  return out
}

// ── Contact deletions (REST) ──────────────────────────────
const first = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null }

/**
 * A delete operation under SFMC's documented names (getListOfContactDeleteOperations):
 * operationID, operationName, status (PendingProcessing, Cancelling, Cancelled, Failed,
 * Completed, CompletedWithErrors), deleteType (None, ContactAndAttributes, AttributesOnly),
 * listName/listKey, expectedListCount, actualListCount, successCount, errorCount,
 * scheduledTime, startTime, endTime, restorableUntilDate, createdDate, createdBy (an
 * employee ID). Older spellings are kept as fallbacks.
 */
export function deleteOperationRow(o) {
  return {
    id: String(first(o, ['operationID', 'operationId', 'OperationID', 'id']) ?? ''),
    name: String(first(o, ['operationName', 'OperationName']) ?? ''),
    status: String(first(o, ['status', 'operationStatus', 'Status']) ?? ''),
    type: DELETE_TYPES[first(o, ['deleteType', 'DeleteType'])] ?? String(first(o, ['deleteType', 'DeleteType']) ?? ''),
    list: String(first(o, ['listName', 'listKey', 'listIdentifier']) ?? ''),
    createdDate: first(o, ['createdDate', 'CreatedDate']) || '',
    scheduledDate: first(o, ['scheduledTime']) || '',
    startDate: first(o, ['startTime', 'startDate']) || '',
    endDate: first(o, ['endTime', 'endDate']) || '',
    restorableUntil: first(o, ['restorableUntilDate']) || '',
    requested: num(first(o, ['actualListCount', 'expectedListCount'])),
    deleted: num(first(o, ['successCount', 'deletedCount'])),
    failed: num(first(o, ['errorCount', 'failedCount'])),
    createdBy: String(first(o, ['createdBy', 'employeeID']) ?? ''),
    raw: o,
  }
}
const DELETE_TYPES = { None: 'None', ContactAndAttributes: 'Contacts and their data', AttributesOnly: 'Data only' }

/** One page of delete operations: { page, pageSize, count, items }. */
export async function fetchDeleteOperations(stack, page = 1, fetch = sfmcFetch) {
  const d = await fetch(`${API(stack)}/contacts/v1/contacts/deleteOperations?$page=${page}&$pagesize=50`, 'GET')
  const items = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : []
  return { page: num(d?.page) ?? page, pageSize: num(d?.pageSize) ?? 50, count: num(d?.count) ?? items.length, items }
}

/** Every delete operation (pages of 50, up to 20 pages). */
export async function fetchAllDeleteOperations(stack, fetch = sfmcFetch) {
  const out = []
  let count = 0
  for (let page = 1; page <= 20; page++) {
    const d = await fetchDeleteOperations(stack, page, fetch)
    count = d.count
    out.push(...d.items)
    if (d.items.length < 50 || out.length >= count) break
  }
  return { count, items: out }
}

/** The status of one delete operation (route from SFMC's docs; not checked live). */
export const fetchDeleteStatus = (stack, operationId, fetch = sfmcFetch) =>
  fetch(`${API(stack)}/contacts/v1/contacts/actions/delete/status?operationID=${enc(operationId)}`, 'GET')

/** A missing permission rather than a failure (403 or SFMC's "not authorized" text). */
export const isNotAuthorized = (e) => e?.status === 403 || /\b403\b|not authori[sz]ed/i.test(String(e?.message || ''))

/**
 * { summary } or { notAuthorized: true } when the user or account may not read deletion
 * analytics. SFMC requires startdateutc and enddateutc (ContactsDeleteRequestsSummary);
 * the last `days` days are asked for.
 */
export async function fetchDeleteSummary(stack, fetch = sfmcFetch, { days = 30, now = Date.now() } = {}) {
  const end = new Date(now).toISOString()
  const start = new Date(now - days * 86400000).toISOString()
  try {
    return { summary: await fetch(`${API(stack)}/contacts/v1/contacts/analytics/deleterequests/summary?startdateutc=${enc(start)}&enddateutc=${enc(end)}`, 'GET') }
  } catch (e) {
    if (isNotAuthorized(e)) return { notAuthorized: true }
    throw e
  }
}

/**
 * The summary's totals: { total, byStatus: [{ status, count }], from, to }, from its
 * totaltimeseries and statustimeseries (names in any case, as SFMC's reference mixes them).
 */
export function deleteSummaryTotals(summary) {
  const lower = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const s = lower(summary)
  const total = [].concat(s.totaltimeseries || []).map(lower)
  const byStatus = [].concat(s.statustimeseries || []).map(lower).map((t) => ({ status: String(t.status ?? ''), count: num(t.requestcount) ?? 0 }))
  return { total: total.reduce((n, t) => n + (num(t.requestcount) ?? 0), 0), byStatus, from: s.startdateutc || '', to: s.enddateutc || '' }
}
