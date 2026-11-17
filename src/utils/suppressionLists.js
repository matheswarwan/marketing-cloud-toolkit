// Contacts > Suppression lists (API idea 16, user 2026-11-11). SOAP Retrieve of
// SuppressionListDefinition (each list with SubscriberCount) and SuppressionListContext
// (where a list applies: the enterprise, the business unit, a send classification, a sender
// profile, a publication or one send), plus SendClassification and SenderProfile names.
// None of the SuppressionList* property names were checked live: each read starts with
// SFMC's object reference and falls back to shorter lists when SFMC says a property is not
// valid. Whether one address is on a list is not read: the rows live in the list itself
// and there is no documented Retrieve for that, so the page does not offer it. Read-only.
import { retrieveProps } from './setupApi.js'
import { soapRetrieveAll } from './soapApi.js'

const num = (v) => (v == null || v === '' ? null : Number(v))
const PLACEHOLDER = /^0001-01-01/
const date = (v) => (v && !PLACEHOLDER.test(v) ? v : '')
const low = (v) => String(v || '').toLowerCase()

// Longest list first; the next one is used when SFMC refuses a property of the one before.
export const DEFINITION_PROPS = [
  ['ObjectID', 'ID', 'CustomerKey', 'Name', 'Description', 'Category', 'SubscriberCount', 'CreatedDate', 'ModifiedDate', 'Client.ID'],
  ['ObjectID', 'CustomerKey', 'Name', 'Description', 'SubscriberCount'],
  ['ObjectID', 'CustomerKey', 'Name'],
]
export const CONTEXT_PROPS = [
  ['ObjectID', 'Context', 'Definition.ObjectID', 'Definition.CustomerKey', 'SendClassification.ObjectID', 'SendClassification.CustomerKey',
    'SenderProfile.ObjectID', 'SenderProfile.CustomerKey', 'Send.ID', 'Publication.ID', 'AppliesToAllSends', 'CreatedDate', 'ModifiedDate', 'Client.ID'],
  ['ObjectID', 'Context', 'Definition.ObjectID', 'SendClassification.ObjectID', 'SenderProfile.ObjectID', 'Send.ID'],
  ['ObjectID', 'Context', 'Definition.ObjectID'],
]
const NAME_PROPS = ['ObjectID', 'CustomerKey', 'Name']

/** soapRetrieveAll over `lists` (longest first), moving on while SFMC refuses a property. */
export async function retrieveWithFallbacks(stack, objectType, lists, options = {}) {
  try {
    return await retrieveProps(stack, objectType, lists[0], lists[1] || lists[0], options)
  } catch (e) {
    if (lists.length < 3 || !/propert/i.test(e?.message || '')) throw e
    return soapRetrieveAll(stack, objectType, lists[2], options)
  }
}

export function suppressionListRow(d) {
  return {
    id: d.ObjectID || '', numericId: num(d.ID), key: d.CustomerKey || '', name: d.Name || '', description: d.Description || '',
    folderId: num(d.Category), count: num(d.SubscriberCount), createdDate: date(d.CreatedDate), modifiedDate: date(d.ModifiedDate), mid: num(d.Client?.ID),
  }
}

/**
 * Preview data for a list's addresses. A suppression list is stored as a data extension:
 * the customobjectdata rowset by the list's CustomerKey answers with customObjectId equal to
 * the list's ObjectID and its rows (Email Address, Date Added), checked live on s10,
 * 2026-11-17 (user asked to open, search and export a list). Null without a key.
 */
export function suppressionPreviewTo(list) {
  if (!list?.key) return null
  return { path: '/data-extensions/preview', query: { id: list.id || '', key: list.key, name: list.name || list.key } }
}

export function suppressionContextRow(c) {
  return {
    id: c.ObjectID || '', context: c.Context || '',
    definitionId: c.Definition?.ObjectID || '', definitionKey: c.Definition?.CustomerKey || '',
    classificationId: c.SendClassification?.ObjectID || '', classificationKey: c.SendClassification?.CustomerKey || '',
    senderProfileId: c.SenderProfile?.ObjectID || '', senderProfileKey: c.SenderProfile?.CustomerKey || '',
    sendId: num(c.Send?.ID) || null, publicationId: num(c.Publication?.ID) || null,
    appliesToAll: c.AppliesToAllSends === 'true', mid: num(c.Client?.ID),
  }
}

const findIn = (list, id, key) => list.find((x) => (id && low(x.id) === low(id)) || (key && x.key === key)) || null

/**
 * Where one context applies, in words. `names`: { classifications[], profiles[] } of
 * { id, key, name } rows. Returns { kind, label }.
 */
export function describeContext(ctx, names = {}) {
  const kind = String(ctx.context || '')
  const k = kind.toLowerCase()
  if (k === 'enterprise') return { kind: 'Enterprise', label: 'Every send in every business unit of the enterprise' }
  if (k === 'businessunit') return { kind: 'Business unit', label: `Every send in the business unit${ctx.mid ? ` (MID ${ctx.mid})` : ''}` }
  if (k === 'sendclassification' || ctx.classificationId || ctx.classificationKey) {
    const c = findIn(names.classifications || [], ctx.classificationId, ctx.classificationKey)
    return { kind: 'Send classification', label: `Sends with the send classification ${c?.name || ctx.classificationKey || ctx.classificationId || '(unknown)'}` }
  }
  if (k === 'senderprofile' || ctx.senderProfileId || ctx.senderProfileKey) {
    const p = findIn(names.profiles || [], ctx.senderProfileId, ctx.senderProfileKey)
    return { kind: 'Sender profile', label: `Sends with the sender profile ${p?.name || ctx.senderProfileKey || ctx.senderProfileId || '(unknown)'}` }
  }
  if (k === 'publication' || ctx.publicationId) return { kind: 'Publication', label: `Sends to the publication list ${ctx.publicationId ?? '(unknown)'}` }
  if (k === 'send' || ctx.sendId) return { kind: 'Send', label: ctx.sendId ? `The send with JobID ${ctx.sendId}` : 'One send' }
  if (ctx.appliesToAll) return { kind: 'All sends', label: 'Every send' }
  return { kind: kind || 'Unknown', label: kind ? `${kind} (as SFMC names it)` : 'SFMC did not say where it applies' }
}

/** Contexts per list (matched by ObjectID, else external key), and the contexts that match no list. */
export function joinContexts(lists, contexts, names = {}) {
  const used = new Set()
  const out = lists.map((l) => {
    const mine = contexts.filter((c, i) => {
      const hit = (c.definitionId && low(c.definitionId) === low(l.id)) || (c.definitionKey && c.definitionKey === l.key)
      if (hit) used.add(i)
      return hit
    }).map((c) => ({ ...c, ...describeContext(c, names) }))
    return { ...l, contexts: mine, appliesTo: mine.map((c) => c.label).join('; ') }
  })
  return { lists: out, orphans: contexts.filter((_, i) => !used.has(i)).length }
}

/** { lists, subscribers, unlinked }: counts for the summary line. Lists with no count add nothing. */
export function suppressionSummary(lists, contextsRead = true) {
  return {
    lists: lists.length,
    subscribers: lists.reduce((n, l) => n + (l.count || 0), 0),
    unlinked: contextsRead ? lists.filter((l) => !l.contexts.length).length : null,
  }
}

/**
 * Every suppression list with where it applies.
 * Returns { lists[], contextsRead, notes[] }. Only the definitions are required: a failed
 * context or name read becomes a note.
 */
export async function fetchSuppressionLists(stack, { allBusinessUnits = false, retrieve } = {}) {
  const options = { ...(retrieve ? { retrieve } : {}), ...(allBusinessUnits ? { queryAllAccounts: true } : {}) }
  const notes = []
  const named = (type) => soapRetrieveAll(stack, type, NAME_PROPS, retrieve ? { retrieve } : {})
    .then((rows) => rows.map((r) => ({ id: r.ObjectID || '', key: r.CustomerKey || '', name: r.Name || '' })))
    .catch(() => [])
  const [defs, contexts, classifications, profiles] = await Promise.all([
    retrieveWithFallbacks(stack, 'SuppressionListDefinition', DEFINITION_PROPS, options),
    retrieveWithFallbacks(stack, 'SuppressionListContext', CONTEXT_PROPS, options)
      .catch((e) => { notes.push(`Where each list applies could not be read: ${e.message}`); return null }),
    named('SendClassification'),
    named('SenderProfile'),
  ])
  const rows = defs.map(suppressionListRow).sort((a, b) => a.name.localeCompare(b.name))
  const { lists, orphans } = joinContexts(rows, (contexts || []).map(suppressionContextRow), { classifications, profiles })
  if (orphans) notes.push(`${orphans} ${orphans === 1 ? 'setting points' : 'settings point'} at a suppression list that is not in this list (it may belong to another business unit).`)
  if (rows.length && rows.every((l) => l.count == null)) notes.push('SFMC did not return subscriber counts for these lists.')
  return { lists, contextsRead: contexts != null, notes }
}
