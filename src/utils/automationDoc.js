// The export document for one automation (from SFMC Automation Viewer's
// downloadAutomation.js): overview, schedule, error notifications, then every step's
// activities with their details.
import { describeRecurrence } from './ical.js'
import { activityBlocks, activityTypeLabel, describeActivity } from './activityTypes.js'
import { formatDateTime } from './format.js'
import { fetchAutomation, fetchActivityDetails } from './automationApi.js'
import { runInBatches } from './batchRunner.js'

export function automationOverviewRows(d) {
  return [
    ['Name', d.name], ['Key', d.key], ['Type', d.type], ['Status', d.status],
    ['Last run', formatDateTime(d.lastRunTime)], ['Last run status', d.lastRunStatus],
    ['Created', formatDateTime(d.createdDate)], ['Modified', formatDateTime(d.modifiedDate)], ['ID', d.id],
  ].filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
}

export function scheduleRows(s) {
  if (!s) return []
  return [
    ['Status', s.scheduleStatus], ['Recurrence', describeRecurrence(s.icalRecur) || s.icalRecur], ['Time zone', s.timezoneName],
    ['Start', formatDateTime(s.startDate)], ['Next run', formatDateTime(s.scheduledTime)], ['End', formatDateTime(s.endDate)],
  ].map(([k, v]) => [k, v ? String(v) : '—'])
}

/**
 * @param {object} details   the automation
 * @param {object|null} notifications
 * @param {(stepIdx, actIdx) => object|null} descFor  the described activity, if loaded
 */
export function automationDoc(details, notifications, descFor) {
  const blocks = [
    { type: 'h', level: 2, text: 'Overview' },
    { type: 'kv', rows: automationOverviewRows(details) },
  ]
  if (details.schedule) blocks.push({ type: 'h', level: 2, text: 'Schedule' }, { type: 'kv', rows: scheduleRows(details.schedule) })
  const workers = notifications?.workers || []
  if (workers.length) {
    blocks.push({ type: 'h', level: 2, text: 'Error notifications' },
      { type: 'table', columns: ['Type', 'Recipient', 'Channel'], rows: workers.map((w) => [w.notificationType || '', w.definition || '', w.channelType || '']) })
  }
  ;(details.steps || []).forEach((step, si) => {
    blocks.push({ type: 'h', level: 2, text: `Step ${si + 1}${step.name ? `: ${step.name}` : ''}` })
    ;(step.activities || []).forEach((a, ai) => {
      const desc = descFor(si, ai)
      if (desc) blocks.push(...activityBlocks(desc, `${si + 1}.${ai + 1}`))
      else blocks.push({ type: 'h', level: 3, text: `${si + 1}.${ai + 1}: ${a.name || ''}` }, { type: 'p', text: `${activityTypeLabel(a.objectTypeId)}. Details could not be loaded.` })
    })
    if (!step.activities?.length) blocks.push({ type: 'p', text: 'No activities.' })
  })
  return { title: details.name || 'Automation', blocks }
}

/**
 * One document for several automations (feedback #40): a summary table, then each
 * automation's full export with its headings one level down. Loads 2 automations
 * at a time (and 4 activities at a time within each); one that cannot be read
 * gets a note instead. onProgress(done, total).
 */
export async function automationsDoc(stack, list, { onProgress, shouldStop } = {}) {
  const docs = new Array(list.length)
  await runInBatches(list, 2, async (a, i) => {
    try {
      const { details, notifications } = await fetchAutomation(stack, a.id)
      const items = []
      ;(details.steps || []).forEach((s, si) => (s.activities || []).forEach((x, ai) => items.push({ x, k: `${si}.${ai}` })))
      const acts = {}
      await runInBatches(items, 4, async ({ x, k }) => {
        try { acts[k] = describeActivity(x.objectTypeId, await fetchActivityDetails(stack, x), stack) } catch { acts[k] = null }
      })
      docs[i] = automationDoc(details, notifications, (si, ai) => acts[`${si}.${ai}`] || null)
    } catch (e) {
      docs[i] = { title: a.name || 'Automation', blocks: [{ type: 'p', text: `Could not load this automation: ${e.message}` }] }
    }
  }, { onProgress, shouldStop })
  const blocks = [{
    type: 'table', columns: ['Name', 'Status', 'Last run', 'Last run at', 'Modified'],
    rows: list.map((a) => [a.name || '', String(a.status ?? ''), String(a.lastRunStatus ?? ''), formatDateTime(a.lastRunTime), formatDateTime(a.modifiedDate)]),
  }]
  docs.forEach((d) => {
    if (!d) return
    blocks.push({ type: 'h', level: 2, text: d.title })
    for (const b of d.blocks) blocks.push(b.type === 'h' ? { ...b, level: Math.min((b.level || 2) + 1, 6) } : b)
  })
  return { title: list.length === 1 ? list[0].name || 'Automation' : `${list.length} automations`, blocks }
}
