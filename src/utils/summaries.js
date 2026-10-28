// Counts for the automation and journey overviews (feedback #50) and the Toolkit card on
// SFMC's dashboard (#65). Pure, so the service worker can use them too.
import { automationStatusName, isFailure } from './watches.js'

const time = (v) => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t }

function countBy(list, keyOf) {
  const m = new Map()
  for (const x of list) { const k = keyOf(x) || 'Unknown'; m.set(k, (m.get(k) || 0) + 1) }
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

const RUNNING_TOO_LONG = 6 * 3600 * 1000

/** Counts by status and last run, and the automations that need a look. */
export function summarizeAutomations(list, now = Date.now()) {
  const status = (a) => automationStatusName(a.status)
  const attention = []
  for (const a of list) {
    const s = status(a)
    if (isFailure(a.lastRunStatus)) attention.push({ automation: a, reason: `Last run: ${a.lastRunStatus}` })
    else if (/error/i.test(s)) attention.push({ automation: a, reason: `Status: ${s}` })
    else if (/^running$/i.test(s) && a.lastRunTime && now - time(a.lastRunTime) > RUNNING_TOO_LONG) attention.push({ automation: a, reason: 'Running for more than 6 hours' })
  }
  attention.sort((x, y) => time(y.automation.lastRunTime) - time(x.automation.lastRunTime))
  return {
    total: list.length,
    byStatus: countBy(list, status),
    byLastRun: countBy(list.filter((a) => a.lastRunStatus), (a) => String(a.lastRunStatus)),
    failedLastRun: list.filter((a) => isFailure(a.lastRunStatus)).length,
    attention,
  }
}

export const LIVE_JOURNEY = /^(published|running|scheduledtopublish)$/i

export function summarizeJourneys(list) {
  return { total: list.length, byStatus: countBy(list, (j) => j.status), live: list.filter((j) => LIVE_JOURNEY.test(j.status || '')).length }
}
