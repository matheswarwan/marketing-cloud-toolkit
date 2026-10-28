// Documents for the Download menu on the Automation and Journey overview pages
// (feedback #69: copy the page to share it). Pure: the pages pass what they show.
import { automationStatusName } from './watches.js'
import { formatDateTime } from './format.js'

const when = (ms) => (ms ? formatDateTime(new Date(ms).toISOString()) : '')

function header(businessUnit, savedAt, stack) {
  const rows = []
  if (businessUnit) rows.push(['Business unit', businessUnit])
  if (stack) rows.push(['Stack', stack])
  if (savedAt) rows.push(['Read', when(savedAt)])
  return rows.length ? [{ type: 'kv', rows }] : []
}

const byStatus = (list) => ({ type: 'table', columns: ['Status', 'Count'], rows: (list || []).map((s) => [s.label, s.count]) })

export function automationOverviewDoc({ businessUnit, stack, savedAt, summary, trends, trendDays, watched = [] }) {
  const blocks = [...header(businessUnit, savedAt, stack)]
  if (summary) {
    blocks.push(
      { type: 'h', level: 2, text: 'Summary' },
      { type: 'kv', rows: [['Automations', summary.total], ['Last run failed', summary.failedLastRun]] },
      { type: 'h', level: 3, text: 'By status' },
      byStatus(summary.byStatus),
      { type: 'h', level: 2, text: `Needs a look (${summary.attention.length})` },
      {
        type: 'table',
        columns: ['Automation', 'Status', 'Why', 'Last run'],
        rows: summary.attention.map((x) => [x.automation.name, automationStatusName(x.automation.status), x.reason, formatDateTime(x.automation.lastRunTime)]),
      },
    )
  }
  if (trends) {
    const ok = trends.days.reduce((n, d) => n + d.ok, 0)
    const failed = trends.days.reduce((n, d) => n + d.failed, 0)
    blocks.push(
      { type: 'h', level: 2, text: `Run trends, last ${trendDays} days` },
      { type: 'p', text: `${ok + failed} runs, ${failed} failed, across ${trends.read} automations that ran in the period${trends.errors ? `; ${trends.errors} run logs could not be read` : ''}.` },
      { type: 'h', level: 3, text: 'Per day' },
      { type: 'table', columns: ['Day', 'Succeeded', 'Failed'], rows: trends.days.map((d) => [d.key, d.ok, d.failed]) },
      { type: 'h', level: 3, text: 'Per automation (most failures first)' },
      {
        type: 'table',
        columns: ['Automation', 'Runs', 'Failed', 'Last run', 'Last failure'],
        rows: trends.perAutomation.filter((p) => p.runs).map((p) => [
          p.automation.name, p.runs, p.failed, formatDateTime(p.lastRun?.start),
          p.lastFailure ? `${formatDateTime(p.lastFailure.start)} ${p.lastFailure.message || ''}`.trim() : '',
        ]),
      },
    )
  }
  blocks.push(
    { type: 'h', level: 2, text: `Watched (${watched.length})` },
    {
      type: 'table',
      columns: ['Automation', 'Status', 'Last run', 'Checked'],
      rows: watched.map((w) => [w.name, automationStatusName(w.last?.status), `${formatDateTime(w.last?.lastRunTime)} ${w.last?.lastRunStatus || ''}`.trim(), w.checkedAt ? when(w.checkedAt) : 'Not yet']),
    },
  )
  return { title: 'Automation overview', blocks }
}

export function journeyOverviewDoc({ businessUnit, stack, savedAt, summary, sends }) {
  const blocks = [...header(businessUnit, savedAt, stack)]
  if (summary) {
    blocks.push(
      { type: 'h', level: 2, text: 'Summary' },
      { type: 'kv', rows: [['Journeys', summary.total], ['Live (published or scheduled)', summary.live]] },
      { type: 'h', level: 3, text: 'By status' },
      byStatus(summary.byStatus),
    )
  }
  if (sends) {
    blocks.push(
      { type: 'h', level: 2, text: 'What live journeys send' },
      { type: 'p', text: `${sends.checked} live journeys checked.` },
      {
        type: 'table',
        columns: ['Journey', 'Status', 'Email', 'SMS', 'Push / in-app', 'Modified'],
        rows: sends.rows.map((r) => [r.journey.name + (r.error ? ` (${r.error})` : ''), r.journey.status, r.email.join(', '), r.sms.join(', '), r.push.join(', '), formatDateTime(r.journey.modifiedDate)]),
      },
    )
  }
  return { title: 'Journey overview', blocks }
}
