// Automation and journey overviews (feedback #50): everything in the business unit,
// counted by status, what needs a look, run trends from the run log, and which
// published journeys send email, SMS or push.
import { searchAutomations, loadMoreAutomations, fetchRunHistory } from './automationApi.js'
import { searchJourneys, fetchJourney, JOURNEY_PAGE_SIZE } from './journeys.js'
import { isFailure } from './watches.js'
import { runInBatches } from './batchRunner.js'
import { LIVE_JOURNEY } from './summaries.js'

// The counts are in summaries.js (the service worker uses them too).
export { summarizeAutomations, summarizeJourneys, LIVE_JOURNEY } from './summaries.js'

const MAX_ITEMS = 2000
const time = (v) => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t }

/** Every automation (up to 2,000), loading 50 at a time. onProgress(loaded, total). */
export async function listAllAutomations(stack, onProgress = () => {}) {
  const first = await searchAutomations(stack, '', 0)
  let items = first.entries
  let total = first.total
  onProgress(items.length, total)
  while (items.length < Math.min(total, MAX_ITEMS)) {
    const r = await loadMoreAutomations(stack, '', items)
    if (!r.entries.length) break
    items = items.concat(r.entries)
    total = r.total
    onProgress(items.length, total)
  }
  return items
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * Every run of one automation since `since` (feedback #1007: one call returns the newest
 * `top` runs only, so an automation that runs every 15 minutes filled 200 runs in two days
 * and older days looked empty). Reads again with the end date moved back to the oldest run
 * read, up to `maxCalls` times; runs are deduplicated by id (or start). A day with more
 * than `top` runs cannot be read in full: it is counted in `partialDays`.
 */
export async function fetchRunsSince(stack, id, { since, now, days, top = 200, maxCalls = 15, fetch = fetchRunHistory } = {}) {
  const seen = new Map()
  const partialDays = new Set()
  let end = new Date(now)
  for (let call = 0; call < maxCalls; call++) {
    const { runs } = await fetch(stack, id, { days, top, now: new Date(now), end })
    for (const r of runs) seen.set(r.id || r.start, r)
    if (runs.length < top) break
    const oldest = Math.min(...runs.map((r) => time(r.start)).filter(Boolean))
    if (!Number.isFinite(oldest) || oldest <= since) break
    let next = new Date(oldest)
    // The API takes whole days: when the oldest run is on the end day itself, that day
    // has more than `top` runs. Count it as partial and go on with the day before.
    if (dayKey(next) === dayKey(end)) { partialDays.add(dayKey(next)); next = new Date(oldest - 86400000) }
    if (next.getTime() < since) break
    end = next
  }
  return { runs: [...seen.values()], partialDays }
}

/**
 * Runs per day (succeeded / failed) over the last `days`, from the run log of the
 * `max` most recently run automations, 4 at a time. Returns { days: [{ key, ok,
 * failed }], perAutomation: [{ automation, runs, failed, lastFailure }], read, errors }.
 */
export async function runTrends(stack, list, { days = 30, max = 40, now = Date.now(), onProgress, fetch = fetchRunHistory } = {}) {
  const since = now - days * 86400000
  const recent = list.filter((a) => time(a.lastRunTime) >= since).sort((a, b) => time(b.lastRunTime) - time(a.lastRunTime)).slice(0, max)
  const perDay = new Map()
  // Each day also lists its runs, so a click on the chart can show which automations ran (feedback #62).
  for (let t = since; t <= now; t += 86400000) perDay.set(dayKey(t), { key: dayKey(t), ok: 0, failed: 0, runs: [] })
  const perAutomation = []
  const partial = new Set()
  let errors = 0
  await runInBatches(recent, 4, async (a) => {
    try {
      const { runs, partialDays } = await fetchRunsSince(stack, a.id, { since, now, days, fetch })
      partialDays.forEach((d) => partial.add(d))
      let failed = 0
      let lastFailure = null
      for (const r of runs) {
        const t = time(r.start)
        if (!t) continue
        const d = perDay.get(dayKey(t))
        const bad = isFailure(r.status)
        if (d) {
          bad ? d.failed++ : d.ok++
          d.runs.push({ automation: a, start: r.start, status: r.status, failed: bad, message: r.message || '' })
        }
        if (bad) { failed++; if (!lastFailure || t > time(lastFailure.start)) lastFailure = r }
      }
      const last = runs.reduce((m, r) => (time(r.start) > time(m?.start) ? r : m), null)
      perAutomation.push({ automation: a, runs: runs.length, failed, lastFailure, lastRun: last })
    } catch {
      errors++
    }
  }, { onProgress })
  perAutomation.sort((x, y) => y.failed - x.failed || y.runs - x.runs)
  for (const d of perDay.values()) d.runs.sort((x, y) => time(y.start) - time(x.start))
  return { days: [...perDay.values()], perAutomation, read: recent.length, errors, partialDays: [...partial].sort() }
}

/** Every journey's latest version (up to 2,000). */
export async function listAllJourneys(stack, onProgress = () => {}) {
  let page = 1
  let items = []
  let total = Infinity
  while (items.length < Math.min(total, MAX_ITEMS)) {
    const r = await searchJourneys(stack, { page })
    items = items.concat(r.items)
    total = r.total
    onProgress(items.length, total)
    if (r.items.length < JOURNEY_PAGE_SIZE) break
    page++
  }
  return items
}

const CHANNELS = [['email', /EMAIL/], ['sms', /SMS/], ['push', /PUSH|INAPP|INBOX/], ['whatsapp', /WHATSAPP/]]

/** What each live journey sends, read from its definition (up to `max`, 4 at a time). */
export async function journeyChannels(stack, journeys, { max = 100, onProgress } = {}) {
  const live = journeys.filter((j) => LIVE_JOURNEY.test(j.status || '')).slice(0, max)
  const rows = []
  await runInBatches(live, 4, async (j) => {
    try {
      const def = await fetchJourney(stack, j.id, j.version)
      const counts = { email: [], sms: [], push: [], whatsapp: [] }
      for (const a of def?.activities || []) {
        const t = String(a.type || '').toUpperCase()
        const ch = CHANNELS.find(([, re]) => re.test(t))
        if (ch) counts[ch[0]].push(a.name || t)
      }
      rows.push({ journey: j, ...counts })
    } catch (e) {
      rows.push({ journey: j, error: e.message, email: [], sms: [], push: [], whatsapp: [] })
    }
  }, { onProgress })
  rows.sort((a, b) => b.email.length - a.email.length || String(a.journey.name).localeCompare(String(b.journey.name)))
  return { rows, checked: live.length, sendingEmail: rows.filter((r) => r.email.length).length }
}
