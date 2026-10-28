// Data view archive: data views keep about six months of tracking, so a daily
// automation copies recent rows into data extensions that keep them. Fields are
// the Toolkit's data view definitions (utils/dataViews.js); each query upserts
// (Update) the last few days, so a missed run is caught up by the next one.
import { DATA_VIEW_FIELDS } from '../dataViews.js'

const KEY_FIELDS = ['JobID', 'ListID', 'BatchID', 'SubscriberID', 'EventDate']

export const ARCHIVE_VIEWS = {
  _Sent: { keys: KEY_FIELDS, date: 'EventDate' },
  _Open: { keys: KEY_FIELDS, date: 'EventDate' },
  // Two links clicked in the same second differ only by link name.
  _Click: { keys: [...KEY_FIELDS, 'LinkName'], date: 'EventDate' },
  _Bounce: { keys: KEY_FIELDS, date: 'EventDate' },
  _Unsubscribe: { keys: KEY_FIELDS, date: 'EventDate' },
  _Complaint: { keys: KEY_FIELDS, date: 'EventDate' },
  _Job: { keys: ['JobID'], date: 'CreatedDate' },
}

const TEXT_LENGTHS = { SubscriberKey: 254, Domain: 128, URL: 4000, LinkContent: 4000, SMTPBounceReason: 4000, SMTPMessage: 4000, EmailSubject: 1000, DynamicEmailSubject: 4000, EmailName: 255, LinkName: 500 }
// Email and Phone become Text: SFMC refused _Job's BccEmail as an Email field
// ("Length is invalid for field BccEmail", feedback #43), and an archive does not
// need those types.
const TYPE_NAMES = { 0: 'text', 1: 'number', 2: 'date', 3: 'boolean', 4: 'text', 5: 'text' }

export function archiveFields(view) {
  const spec = ARCHIVE_VIEWS[view]
  return (DATA_VIEW_FIELDS[view.toUpperCase()] || []).map((f) => {
    const isKey = spec.keys.includes(f.name)
    const field = { name: f.name, type: TYPE_NAMES[f.type] || 'text', isPrimaryKey: isKey, isNullable: !isKey }
    if (field.type === 'text') field.length = TEXT_LENGTHS[f.name] || (f.type === 4 ? 254 : 255)
    return field
  })
}

// LinkName is part of _Click's key, so it cannot be null. Dates in a key are cut to
// whole seconds (feedback #152: _Click still hit "Violation of PRIMARY KEY constraint"
// with one row per key; two events a few milliseconds apart are kept apart by
// ROW_NUMBER but likely become the same key in the data extension's Date field).
const expr = (f) => {
  if (f.name === 'LinkName') return `LEFT(ISNULL(LinkName, ''), 500)`
  if (f.type === 'date' && f.isPrimaryKey) return `CONVERT(DATETIME, CONVERT(CHAR(19), ${f.name}, 120), 120)`
  return f.type === 'text' ? `LEFT(${f.name}, ${f.length})` : f.name
}

/**
 * Data views can hold more than one row for the same key (two clicks on the same
 * link in the same second), which an Update query refuses ("Violation of PRIMARY
 * KEY constraint", feedback #56), so only one row per key is kept. Text is cut to
 * the field length so a long value cannot fail the run.
 */
export function archiveSql(view, fields, days) {
  const spec = ARCHIVE_VIEWS[view]
  const keyExprs = fields.filter((f) => f.isPrimaryKey).map(expr)
  return `SELECT\n    ${fields.map((f) => f.name).join(',\n    ')}\nFROM (\n  SELECT\n    ${fields.map((f) => `${expr(f)} AS ${f.name}`).join(',\n    ')},\n` +
    `    ROW_NUMBER() OVER (PARTITION BY ${keyExprs.join(', ')} ORDER BY ${spec.date} DESC) AS RowNum\n` +
    `  FROM ${view}\n  WHERE ${spec.date} >= DATEADD(day, -${days}, GETDATE())\n) AS r\nWHERE RowNum = 1`
}

export const dataViewArchive = {
  id: 'data-view-archive',
  title: 'Data view archive',
  summary: 'Copies Sent, Open, Click, Bounce, Unsubscribe, Complaint and Job data view rows into data extensions every day, so tracking older than six months is kept.',

  defaults: { views: Object.keys(ARCHIVE_VIEWS), days: 3, prefix: 'Archive', automationName: 'Data view archive - daily' },

  options: [
    { key: 'views', label: 'Data views', type: 'multi', choices: Object.keys(ARCHIVE_VIEWS) },
    { key: 'days', label: 'Days copied on each run', type: 'number', min: 1, max: 180 },
    { key: 'prefix', label: 'Data extension name prefix', type: 'text', help: 'Archive gives Archive_Sent, Archive_Open, ...' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],

  before: [
    'Data extensions grow every day. Consider data retention on them (Contact Builder > the data extension > Data Retention Policy) if you only need, say, two years.',
  ],

  after: (o) => [
    `Schedule "${o.automationName}" to run daily in Automation Studio (it is not scheduled and was not run).`,
    `Each run copies the last ${o.days} days, so a missed day is picked up by the next run.`,
    'If you made these with an earlier version of the Toolkit, delete the old archive data extensions, queries and automation and run this template again: the queries now keep one row per key, and _Job\'s DynamicEmailSubject and EventID are text.',
    'To copy everything the data views still hold (about six months), change the number of days in each query to 180, run the automation once, then change it back.',
  ],

  plan(o) {
    const views = o.views.filter((v) => ARCHIVE_VIEWS[v])
    if (!views.length) throw new Error('Pick at least one data view.')
    const days = Number.isInteger(o.days) && o.days > 0 && o.days <= 180 ? o.days : 3
    const des = []
    const queries = []
    for (const view of views) {
      const spec = ARCHIVE_VIEWS[view]
      const base = `${o.prefix}${view}`
      const fields = archiveFields(view)
      des.push({ ref: view, name: base, key: `${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-de`, fields })
      queries.push({ ref: view, name: `${base} - copy`, target: view, updateType: 1, sql: archiveSql(view, fields, days) })
    }
    return {
      des,
      queries,
      automation: {
        name: o.automationName,
        description: 'Created by Marketing Cloud Toolkit (Data view archive template). Schedule it daily.',
        // Every query writes its own data extension, so they run side by side.
        steps: [{ name: 'Copy data views', queries: queries.map((q) => q.ref) }],
      },
    }
  },
}
