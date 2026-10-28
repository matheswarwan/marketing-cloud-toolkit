// The Marketing Cloud Toolkit card on SFMC's Marketing Cloud Dashboard page (feedback #65, a
// trial; public/dashboardPanel.js). Reads every automation and journey of the
// current business unit, like the overview pages, and sends back a small summary.
// Kept for 10 minutes per stack and business unit unless the card asks for a refresh.
import { sfmcFetch } from './fetchProxy.js'
import { storageGet } from './chromeAsync.js'
import { summarizeAutomations, summarizeJourneys } from '../utils/summaries.js'
import { WATCHES_KEY, watchType, automationStatusName } from '../utils/watches.js'

const AS = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`
const JB = (stack) => `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1`
const PAGE = 50
const MAX_ITEMS = 2000
const KEEP = 10 * 60 * 1000
const cache = new Map() // `stack:buId` → { at, summary }
const running = new Map() // `stack:buId` → Promise

async function currentBU(stack) {
  try {
    const d = await sfmcFetch({ url: `https://mc.${stack}.exacttarget.com/cloud/fuelapi/platform-internal/v1/accounts/@current` })
    return { id: d?.accountId ?? d?.id ?? d?.memberId ?? '', name: d?.name || '' }
  } catch {
    return { id: '', name: '' }
  }
}

async function automationPage(stack, skip, top) {
  const d = await sfmcFetch({ url: `${AS(stack)}/legacy/v1/beta/automations/automation/definition/?$top=${top}&$skip=${skip}&$sort=${encodeURIComponent('lastRunTime desc')}&view=gridView` })
  return { entries: d?.entry || [], total: d?.totalResults ?? (d?.entry || []).length }
}

/** Every automation (up to 2,000), 50 at a time, as the overview reads them (feedback #28's fallback included). */
export async function listAutomations(stack) {
  const first = await automationPage(stack, 0, PAGE)
  const items = [...first.entries]
  const seen = new Set(items.map((a) => a.id))
  let total = first.total
  while (items.length < Math.min(total, MAX_ITEMS)) {
    let r = await automationPage(stack, items.length, PAGE)
    let fresh = r.entries.filter((a) => !seen.has(a.id))
    if (!fresh.length) {
      r = await automationPage(stack, 0, items.length + PAGE)
      fresh = r.entries.filter((a) => !seen.has(a.id))
    }
    if (!fresh.length) break
    fresh.forEach((a) => { seen.add(a.id); items.push(a) })
    total = r.total
  }
  return items
}

/** Every journey's latest version (up to 2,000). */
export async function listJourneys(stack) {
  const items = []
  for (let page = 1; items.length < MAX_ITEMS; page++) {
    const params = new URLSearchParams({ $page: String(page), $pageSize: String(PAGE), $orderBy: 'ModifiedDate DESC', mostRecentVersionOnly: 'true' })
    const d = await sfmcFetch({ url: `${JB(stack)}/interactions?${params}` })
    const got = d?.items || []
    items.push(...got)
    if (got.length < PAGE || items.length >= (d?.count ?? Infinity)) break
  }
  return items
}

/** What the card shows: plain data only (names, counts, ids for links). */
export function dashboardSummary(automations, journeys, watches, stack, now = Date.now()) {
  const a = automations ? summarizeAutomations(automations, now) : null
  const j = journeys ? summarizeJourneys(journeys) : null
  const watched = Object.values(watches || {}).filter((w) => w.stack === stack).map((w) => ({
    type: watchType(w), id: w.id, name: w.name || w.id,
    status: watchType(w) === 'journey' ? (w.last?.status || '') : automationStatusName(w.last?.status),
    lastRunStatus: w.last?.lastRunStatus || '',
  }))
  return {
    at: now,
    automations: a && {
      total: a.total, failedLastRun: a.failedLastRun, byStatus: a.byStatus,
      attention: a.attention.slice(0, 5).map((x) => ({ id: x.automation.id, name: x.automation.name, reason: x.reason })),
      attentionCount: a.attention.length,
    },
    journeys: j && { total: j.total, live: j.live, byStatus: j.byStatus },
    watched,
  }
}

async function build(stack, bu) {
  const [automations, journeys, store] = await Promise.all([
    listAutomations(stack).catch((e) => ({ error: e.message })),
    listJourneys(stack).catch((e) => ({ error: e.message })),
    storageGet('local', [WATCHES_KEY]),
  ])
  const summary = dashboardSummary(Array.isArray(automations) ? automations : null, Array.isArray(journeys) ? journeys : null, store[WATCHES_KEY], stack)
  summary.businessUnit = bu.name
  summary.errors = {
    automations: Array.isArray(automations) ? null : automations.error,
    journeys: Array.isArray(journeys) ? null : journeys.error,
  }
  return summary
}

/** The summary for `stack`: from the last 10 minutes unless `force`. */
export async function getDashboardSummary(stack, { force = false } = {}) {
  if (!/^s\d+$/i.test(stack || '')) throw new Error('No SFMC stack.')
  const bu = await currentBU(stack)
  const key = `${stack}:${bu.id}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < KEEP) return hit.summary
  if (!running.has(key)) {
    running.set(key, build(stack, bu).then((summary) => {
      if (!summary.errors.automations || !summary.errors.journeys) cache.set(key, { at: Date.now(), summary })
      return summary
    }).finally(() => running.delete(key)))
  }
  return running.get(key)
}
