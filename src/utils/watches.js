// Watched automations (feedback #50) and journeys (#59): what to watch, how a change
// becomes a notice.
// Shared by the service worker (background/watches.js checks) and the pages (Watch
// button, notices menu). Pure apart from the storage keys.

export const WATCHES_KEY = 'toolkit_watches' // { 'stack:id' or 'stack:journey:id': { type, stack, id, key, name, on, last, addedAt } }
export const NOTICES_KEY = 'toolkit_watch_notices' // [{ id, at, stack, type, automationId or journeyId, name, kind, text, read }]
export const NOTIFY_KEY = 'toolkit_watch_desktop' // true: also show desktop notifications (optional permission)
export const MAX_NOTICES = 50
export const DEFAULT_ON = { paused: true, activated: true, runs: false, fails: true }
export const JOURNEY_DEFAULT_ON = { paused: true, activated: true, edited: false }
export const WATCH_OPTIONS = {
  automation: [['paused', 'Paused or stopped'], ['activated', 'Activated (scheduled or running again)'], ['fails', 'A run fails'], ['runs', 'Every run']],
  journey: [['paused', 'Paused or stopped'], ['activated', 'Published or resumed'], ['edited', 'A new version or other change']],
}
export const defaultOn = (type) => (type === 'journey' ? JOURNEY_DEFAULT_ON : DEFAULT_ON)
export const watchType = (w) => (w?.type === 'journey' ? 'journey' : 'automation')

// SFMC REST automation status codes.
const STATUS_NAMES = { '-1': 'Error', 0: 'Build error', 1: 'Building', 2: 'Ready', 3: 'Running', 4: 'Paused', 5: 'Stopped', 6: 'Scheduled', 7: 'Awaiting trigger', 8: 'Inactive trigger' }
export function automationStatusName(v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (Number.isInteger(n) && String(n) === String(v).trim() && STATUS_NAMES[n] != null) return STATUS_NAMES[n]
  return String(v)
}

// Automation keys stay `stack:id` so watches from 2.0.6 and 2.0.7 keep working.
export const watchKey = (stack, id, type = 'automation') => (type === 'journey' ? `${stack}:journey:${id}` : `${stack}:${id}`)
const isPausedLike = (s) => /^(paused|stopped)$/i.test(s)
const isActiveLike = (s) => /^(scheduled|awaiting trigger|running)$/i.test(s)
export const isFailure = (s) => /error|fail/i.test(String(s || ''))
const time = (v) => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t }

/**
 * Notices for the change from `prev` to `cur` ({ status, lastRunTime, lastRunStatus }),
 * for the kinds switched on in `on`. No notices without a previous snapshot.
 */
export function diffAutomation(prev, cur, on = DEFAULT_ON) {
  if (!prev || !cur) return []
  const out = []
  const was = automationStatusName(prev.status)
  const now = automationStatusName(cur.status)
  if (now && was && now !== was) {
    if (isPausedLike(now) && on.paused) out.push({ kind: 'paused', text: `is now ${now} (was ${was})` })
    else if (isActiveLike(now) && !isActiveLike(was) && on.activated) out.push({ kind: 'activated', text: `is now ${now} (was ${was})` })
  }
  if (time(cur.lastRunTime) > time(prev.lastRunTime)) {
    const failed = isFailure(cur.lastRunStatus)
    if (failed && on.fails) out.push({ kind: 'fails', text: `run failed${cur.lastRunStatus ? ` (${cur.lastRunStatus})` : ''}` })
    else if (on.runs) out.push({ kind: 'runs', text: `ran${cur.lastRunStatus ? `: ${cur.lastRunStatus}` : ''}` })
  }
  return out
}

/** What a journey watch compares: status, version and last change. */
export const journeySnapshot = (j) => ({ status: j?.status ?? null, version: j?.version ?? null, modifiedDate: j?.modifiedDate ?? null })

/** Notices for a journey's change from `prev` to `cur` ({ status, version, modifiedDate }). */
export function diffJourney(prev, cur, on = JOURNEY_DEFAULT_ON) {
  if (!prev || !cur) return []
  const out = []
  const was = String(prev.status || '')
  const now = String(cur.status || '')
  if (now && was && now !== was) {
    if (/^(paused|stopped)$/i.test(now) && on.paused) out.push({ kind: 'paused', text: `is now ${now} (was ${was})` })
    else if (/^published$/i.test(now) && on.activated) out.push({ kind: 'activated', text: `is now ${now} (was ${was})` })
  }
  if (on.edited) {
    if (Number(cur.version) > Number(prev.version)) out.push({ kind: 'edited', text: `has a new version (${cur.version}, was ${prev.version})` })
    else if (cur.modifiedDate && prev.modifiedDate && time(cur.modifiedDate) > time(prev.modifiedDate)) out.push({ kind: 'edited', text: 'was changed' })
  }
  return out
}

/** The snapshot changes are counted from, for an item from a list or a detail page. */
export const watchSnapshot = (type, item) => (type === 'journey'
  ? journeySnapshot(item)
  : { status: item?.status ?? null, lastRunTime: item?.lastRunTime ?? null, lastRunStatus: item?.lastRunStatus ?? null })

/**
 * Watches every item in `items` with the options `on`. Items already watched keep
 * their snapshot (changes still count from when they were first watched).
 */
export function addWatches(watches, stack, type, items, on, now = Date.now()) {
  const next = { ...watches }
  for (const it of items) {
    if (!it?.id) continue
    const k = watchKey(stack, it.id, type)
    const old = next[k]
    next[k] = {
      ...(type === 'journey' ? { type, key: it.key || old?.key || null } : {}),
      stack, id: it.id, name: it.name || old?.name || it.id, on: { ...on },
      last: old?.last || watchSnapshot(type, it),
      addedAt: old?.addedAt || now,
    }
  }
  return next
}

export function removeWatches(watches, stack, type, ids) {
  const next = { ...watches }
  for (const id of ids) delete next[watchKey(stack, id, type)]
  return next
}

/** Where a notice links to in the app. */
export const noticeRoute = (n) => (n.type === 'journey'
  ? `/journeys/${encodeURIComponent(n.journeyId)}`
  : `/automations/${encodeURIComponent(n.automationId)}`)

/** Adds notices (newest first), keeping at most MAX_NOTICES. */
export function addNotices(list, watch, changes, now = Date.now()) {
  const target = watchType(watch) === 'journey' ? { type: 'journey', journeyId: watch.id } : { automationId: watch.id }
  const added = changes.map((c, i) => ({
    id: `${now.toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`,
    at: now, stack: watch.stack, ...target, name: watch.name, kind: c.kind, text: c.text, read: false,
  }))
  return [...added, ...(Array.isArray(list) ? list : [])].slice(0, MAX_NOTICES)
}

export const unreadCount = (list) => (Array.isArray(list) ? list.filter((n) => !n.read).length : 0)
