// More Automation Templates (user, 2026-10-20): unengaged subscribers, held and
// bouncing subscribers, an automation run log, and unsubscribes for CRM. Each
// writes to its own data extensions; nothing is scheduled or run.
import { DATA_VIEW_FIELDS } from '../dataViews.js'

const text = (name, length, extra = {}) => ({ name, type: 'text', length, ...extra })
const key = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-de`
const days = (v, max = 180) => (Number.isInteger(v) && v > 0 && v <= max ? v : Math.min(90, max))

// Subscribers are kept at the enterprise level: a child business unit reads them as
// ENT._Subscribers.
const SUBSCRIBERS_OPTION = { key: 'fromParent', label: 'Read subscribers from the parent business unit (ENT._Subscribers; needed in a child business unit)', type: 'checkbox' }
const subscribers = (o) => (o.fromParent ? 'ENT._Subscribers' : '_Subscribers')
const oneStep = (name, description, queries) => ({ name, description, steps: queries.map((q, i) => ({ name: `Step ${i + 1}`, queries: [q.ref] })) })

export const unengagedSubscribers = {
  id: 'unengaged-subscribers',
  title: 'Unengaged subscribers',
  summary: 'Subscribers who were sent email in the last N days but neither opened nor clicked, for a re-engagement campaign or suppression.',
  defaults: { days: 90, minSends: 3, fromParent: false, deName: 'Unengaged Subscribers', automationName: 'Unengaged subscribers - find' },
  options: [
    { key: 'days', label: 'Look back (days, at most 180: data views keep about six months)', type: 'number', min: 1, max: 180 },
    { key: 'minSends', label: 'Sent at least this many emails in that time', type: 'number', min: 1, max: 100 },
    SUBSCRIBERS_OPTION,
    { key: 'deName', label: 'Data extension name', type: 'text' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],
  before: ['Opens include machine opens (for example Apple Mail Privacy Protection), so some unengaged people look engaged. Clicks are the stronger signal.'],
  after: (o) => [
    `Run "${o.automationName}" in Automation Studio, or schedule it (weekly is common).`,
    `"${o.deName}" is sendable, so you can send a re-engagement email to it, or use it as a suppression list.`,
  ],
  plan(o) {
    const d = days(o.days)
    const min = Number.isInteger(o.minSends) && o.minSends > 0 ? o.minSends : 3
    const de = {
      ref: 'unengaged', name: o.deName, key: key(o.deName), sendableField: 'SubscriberKey',
      fields: [text('SubscriberKey', 254, { isPrimaryKey: true, isNullable: false }), text('EmailAddress', 254), { name: 'SendsInPeriod', type: 'number' }, { name: 'LastSentDate', type: 'date' }],
    }
    const q = {
      ref: 'unengaged', name: `${o.automationName} - query`, target: 'unengaged', updateType: 0,
      sql: `SELECT
    s.SubscriberKey,
    sub.EmailAddress,
    COUNT(*) AS SendsInPeriod,
    MAX(s.EventDate) AS LastSentDate
FROM _Sent AS s
    LEFT JOIN ${subscribers(o)} AS sub ON sub.SubscriberKey = s.SubscriberKey
WHERE s.EventDate >= DATEADD(day, -${d}, GETDATE())
    AND NOT EXISTS (SELECT 1 FROM _Open AS op WHERE op.SubscriberKey = s.SubscriberKey AND op.EventDate >= DATEADD(day, -${d}, GETDATE()))
    AND NOT EXISTS (SELECT 1 FROM _Click AS cl WHERE cl.SubscriberKey = s.SubscriberKey AND cl.EventDate >= DATEADD(day, -${d}, GETDATE()))
GROUP BY s.SubscriberKey, sub.EmailAddress
HAVING COUNT(*) >= ${min}`,
    }
    return { des: [de], queries: [q], automation: oneStep(o.automationName, 'Created by Marketing Cloud Toolkit (Unengaged subscribers template).', [q]) }
  },
}

export const heldBounced = {
  id: 'held-bounced',
  title: 'Held and bouncing subscribers',
  summary: 'Subscribers SFMC has marked Held or Bounced, and anyone with a hard bounce in the last N days, with their bounce count and last bounce.',
  defaults: { days: 90, fromParent: false, deName: 'Held and Bouncing Subscribers', automationName: 'Held and bouncing subscribers - find' },
  options: [
    { key: 'days', label: 'Hard bounces in the last (days, at most 180)', type: 'number', min: 1, max: 180 },
    SUBSCRIBERS_OPTION,
    { key: 'deName', label: 'Data extension name', type: 'text' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],
  before: [],
  after: (o) => [
    `Run "${o.automationName}" in Automation Studio, or schedule it.`,
    `Review "${o.deName}": fix or remove bad addresses at the source (CRM, sign-up forms), or delete the contacts in Contact Builder.`,
  ],
  plan(o) {
    const d = days(o.days)
    const de = {
      ref: 'held', name: o.deName, key: key(o.deName),
      fields: [text('SubscriberKey', 254, { isPrimaryKey: true, isNullable: false }), text('EmailAddress', 254), text('Status', 50),
        { name: 'HardBounces', type: 'number' }, { name: 'LastBounceDate', type: 'date' }, text('LastBounceReason', 4000)],
    }
    const q = {
      ref: 'held', name: `${o.automationName} - query`, target: 'held', updateType: 0,
      sql: `SELECT
    sub.SubscriberKey,
    sub.EmailAddress,
    sub.Status,
    b.HardBounces,
    b.LastBounceDate,
    (SELECT TOP 1 lb.SMTPBounceReason FROM _Bounce AS lb WHERE lb.SubscriberKey = sub.SubscriberKey ORDER BY lb.EventDate DESC) AS LastBounceReason
FROM ${subscribers(o)} AS sub
    LEFT JOIN (
        SELECT SubscriberKey, COUNT(*) AS HardBounces, MAX(EventDate) AS LastBounceDate
        FROM _Bounce
        WHERE BounceCategory LIKE 'Hard%' AND EventDate >= DATEADD(day, -${d}, GETDATE())
        GROUP BY SubscriberKey
    ) AS b ON b.SubscriberKey = sub.SubscriberKey
WHERE LOWER(sub.Status) IN ('held', 'bounced') OR b.HardBounces > 0`,
    }
    return { des: [de], queries: [q], automation: oneStep(o.automationName, 'Created by Marketing Cloud Toolkit (Held and bouncing subscribers template).', [q]) }
  },
}

const AUTOMATION_RUN_FIELDS = ['AutomationName', 'AutomationCustomerKey', 'AutomationInstanceID', 'AutomationInstanceIsRunOnce', 'AutomationInstanceScheduledTime_UTC',
  'AutomationInstanceStartTime_UTC', 'AutomationInstanceEndTime_UTC', 'AutomationInstanceStatus', 'AutomationInstanceActivityErrorDetails', 'FilenameFromTrigger']
const ACTIVITY_RUN_FIELDS = ['AutomationName', 'AutomationInstanceID', 'ActivityInstanceID', 'ActivityInstanceStep', 'ActivityType', 'ActivityName',
  'ActivityInstanceStartTime_UTC', 'ActivityInstanceEndTime_UTC', 'ActivityInstanceStatus', 'ActivityInstanceStatusDetails']
const TYPES = { 0: 'text', 1: 'number', 2: 'date', 3: 'boolean' }
function viewFields(view, names, keyName) {
  const all = Object.fromEntries((DATA_VIEW_FIELDS[view] || []).map((f) => [f.name, f]))
  return names.map((n) => {
    const t = TYPES[all[n]?.type] || 'text'
    const f = { name: n, type: t, isPrimaryKey: n === keyName, isNullable: n !== keyName }
    if (t === 'text') f.length = /Details|ErrorDetails/.test(n) ? 4000 : /ID$/.test(n) ? 100 : 255
    return f
  })
}

export const automationRunLog = {
  id: 'automation-run-log',
  title: 'Automation run log',
  summary: 'Every automation run, and every activity in it, from the last N days, with status and error details, kept beyond the data views\' six months.',
  defaults: { days: 7, prefix: 'Automation Run Log', automationName: 'Automation run log - daily' },
  options: [
    { key: 'days', label: 'Days copied on each run', type: 'number', min: 1, max: 180 },
    { key: 'prefix', label: 'Data extension name', type: 'text', help: 'The activity log is named the same with " - Activities".' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],
  before: ['Uses the _AutomationInstance and _AutomationActivityInstance data views, which cover this business unit.'],
  after: (o) => [
    `Schedule "${o.automationName}" daily in Automation Studio.`,
    `Find failures by filtering "${o.prefix}" on AutomationInstanceStatus, and "${o.prefix} - Activities" on ActivityInstanceStatus.`,
  ],
  plan(o) {
    const d = days(o.days)
    const runs = { ref: 'runs', name: o.prefix, key: key(o.prefix), fields: viewFields('_AUTOMATIONINSTANCE', AUTOMATION_RUN_FIELDS, 'AutomationInstanceID') }
    const acts = { ref: 'acts', name: `${o.prefix} - Activities`, key: key(`${o.prefix} activities`), fields: viewFields('_AUTOMATIONACTIVITYINSTANCE', ACTIVITY_RUN_FIELDS, 'ActivityInstanceID') }
    const q1 = { ref: 'runs', name: `${o.automationName} - runs`, target: 'runs', updateType: 1,
      sql: `SELECT\n    ${AUTOMATION_RUN_FIELDS.join(',\n    ')}\nFROM _AutomationInstance\nWHERE AutomationInstanceStartTime_UTC >= DATEADD(day, -${d}, GETUTCDATE())` }
    const q2 = { ref: 'acts', name: `${o.automationName} - activities`, target: 'acts', updateType: 1,
      sql: `SELECT\n    ${ACTIVITY_RUN_FIELDS.join(',\n    ')}\nFROM _AutomationActivityInstance\nWHERE ActivityInstanceStartTime_UTC >= DATEADD(day, -${d}, GETUTCDATE())` }
    return {
      des: [runs, acts], queries: [q1, q2],
      automation: { name: o.automationName, description: 'Created by Marketing Cloud Toolkit (Automation run log template). Schedule it daily.', steps: [{ name: 'Copy runs', queries: ['runs', 'acts'] }] },
    }
  },
}

export const crmUnsubscribes = {
  id: 'crm-unsubscribes',
  title: 'Unsubscribes for CRM',
  summary: 'Everyone who unsubscribed in the last N days (from an email or from this business unit), with the date, ready to send back to Salesforce or another CRM.',
  defaults: { days: 7, fromParent: false, deName: 'Unsubscribes for CRM', automationName: 'Unsubscribes for CRM - daily' },
  options: [
    { key: 'days', label: 'Days copied on each run', type: 'number', min: 1, max: 180 },
    SUBSCRIBERS_OPTION,
    { key: 'deName', label: 'Data extension name', type: 'text' },
    { key: 'automationName', label: 'Automation name', type: 'text' },
  ],
  before: [],
  after: (o) => [
    `Schedule "${o.automationName}" daily in Automation Studio.`,
    `Send "${o.deName}" to your CRM: for Salesforce, add a Salesforce Data activity (or a Data Extract and File Transfer for others) after the query in the same automation.`,
  ],
  plan(o) {
    const d = days(o.days)
    const de = {
      ref: 'unsubs', name: o.deName, key: key(o.deName),
      fields: [text('SubscriberKey', 254, { isPrimaryKey: true, isNullable: false }), text('EmailAddress', 254), { name: 'UnsubscribedDate', type: 'date' }, text('Source', 50)],
    }
    const q = {
      ref: 'unsubs', name: `${o.automationName} - query`, target: 'unsubs', updateType: 1,
      sql: `SELECT u.SubscriberKey, sub.EmailAddress, MAX(u.UnsubscribedDate) AS UnsubscribedDate, MIN(u.Source) AS Source
FROM (
    SELECT SubscriberKey, EventDate AS UnsubscribedDate, 'Email' AS Source
    FROM _Unsubscribe
    WHERE EventDate >= DATEADD(day, -${d}, GETDATE())
    UNION ALL
    SELECT SubscriberKey, UnsubDateUTC AS UnsubscribedDate, 'Business unit' AS Source
    FROM _BusinessUnitUnsubscribes
    WHERE UnsubDateUTC >= DATEADD(day, -${d}, GETUTCDATE())
) AS u
    LEFT JOIN ${subscribers(o)} AS sub ON sub.SubscriberKey = u.SubscriberKey
GROUP BY u.SubscriberKey, sub.EmailAddress`,
    }
    return { des: [de], queries: [q], automation: oneStep(o.automationName, 'Created by Marketing Cloud Toolkit (Unsubscribes for CRM template).', [q]) }
  },
}

