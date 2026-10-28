// Automation activity types and how each one's details are shown (from SFMC
// Automation Viewer's activityHtml.js and popup.js). describeActivity() returns plain
// data that ActivityCard renders and the exports reuse:
//
// { typeLabel, title, link, note?, main: [[label, value]], extra: [[label, value]],
//   code: { label, text, lang } | null, tables: [{ title, columns, rows, extra? }] }
//
// Every field a type doesn't list itself ends up in `extra`, so nothing is hidden for
// good. Values are always text: nothing from SFMC is ever rendered as HTML.

import { versionsKeyFor } from './activityVersions.js'
import { startTarget } from './activityStart.js'

export const ACTIVITY_TYPES = {
  33: 'SMS', 42: 'Send Email', 43: 'Import File', 45: 'Group Refresh', 53: 'File Transfer',
  73: 'Data Extract', 84: 'Report', 300: 'SQL Query', 303: 'Filter', 423: 'Script',
  425: 'ELT Activity', 426: 'Refresh Counts', 427: 'Build Audience', 467: 'Wait', 614: 'Life Cycle',
  615: 'Count Audience', 724: 'MC List Refresh', 725: 'MC Send Message', 726: 'MC Import File',
  736: 'Mobile Push', 749: 'Interaction Studio Event', 771: 'Salesforce Send', 783: 'Group Connect',
  952: 'Journey Entry', 1000: 'Data Verification', 1010: 'Thunderhead Refresh',
  1101: 'Interaction Studio Decision', 1701: 'Predictive Intelligence', 3700: 'Contacts BU Mapping',
}
export const activityTypeLabel = (id) => ACTIVITY_TYPES[id] || `Type ${id}`

export const UPDATE_TYPES = { 1: 'Add Only', 2: 'Update Only', 3: 'Add and Update', 4: 'Overwrite' }
export const IMPORT_DESTINATIONS = { 13: 'List', 310: 'Data Extension', 584: 'Mobile Subscription', 613: 'Mobile Push' }

const AS_BASE = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`
const ENDPOINTS = {
  300: 'queries', 303: 'filters', 423: 'scripts', 73: 'dataextracts', 53: 'filetransfers',
  1000: 'dataverifications', 43: 'imports', 425: 'eltactivities',
}

/** URL of an activity's full record, or null when SFMC has none (Wait, Journey, ...). */
export function activityEndpoint(stack, activity) {
  const id = encodeURIComponent(activity.activityObjectId ?? '')
  if (ENDPOINTS[activity.objectTypeId]) return `${AS_BASE(stack)}/automation/v1/${ENDPOINTS[activity.objectTypeId]}/${id}`
  if (activity.objectTypeId === 42) return `${AS_BASE(stack)}/messaging-internal/v1/emailsenddefinition/${id}`
  return null
}

const AS_LINK = (stack, kind, typeId, id) =>
  id ? `https://mc.${stack}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23${kind}/${typeId}/${encodeURIComponent(id)}` : null

export function automationStudioUrl(stack) {
  return `https://mc.${stack}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`
}

/**
 * One automation in Automation Studio (feedback #35). The `#Instance/<id>` route is
 * what Automation Studio shows when an automation is open; not yet checked live.
 */
export function automationUrl(stack, id) {
  return id ? `${automationStudioUrl(stack)}%23Instance/${encodeURIComponent(id)}` : automationStudioUrl(stack)
}

/** A data extension in Contact Builder (needs its ID). */
export function contactBuilderDEUrl(stack, id) {
  return id ? `https://mc.${stack}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${encodeURIComponent(id)}/properties/` : null
}

// ── Values ─────────────────────────────────────────────────
export function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const humanize = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

// Fields of the step's own activity object that say nothing about the activity.
const STEP_FIELDS = new Set(['objectTypeId', 'activityObjectId', 'displayOrder', 'isPaused', 'isActive', 'serializedObject', '_fromStep', 'additionalStepDetails'])

function rest(details, used) {
  return Object.entries(details || {})
    .filter(([k]) => !used.has(k) && !STEP_FIELDS.has(k))
    .map(([k, v]) => [humanize(k), formatValue(v)])
}

function kvTable(title, obj, extra = false) {
  if (!obj || typeof obj !== 'object') return null
  return { title, columns: ['Property', 'Value'], rows: Object.entries(obj).map(([k, v]) => [humanize(k), formatValue(v)]), extra }
}

function nvtTable(title, list, extra = false) {
  if (!Array.isArray(list)) return null
  return { title, columns: ['Name', 'Type', 'Value'], rows: list.map((x) => [formatValue(x?.name), formatValue(x?.type), formatValue(x?.value)]), extra }
}

// spec: { main: [[label, key | fn]], extra: [[label, key | fn]], code, tables, link }
function build(details, typeId, stack, spec) {
  const d = details || {}
  const used = new Set(['name'])
  const pick = ([label, f]) => {
    if (typeof f === 'string') used.add(f)
    return [label, formatValue(typeof f === 'function' ? f(d) : d[f])]
  }
  const main = (spec.main || []).map(pick)
  const extra = (spec.extra || []).map(pick)
  if (spec.code?.key) used.add(spec.code.key)
  for (const k of spec.alsoUsed || []) used.add(k)
  const codeText = spec.code ? d[spec.code.key] : null
  return {
    typeLabel: activityTypeLabel(typeId),
    title: d.name || activityTypeLabel(typeId),
    link: spec.link ? spec.link(d, stack) : null,
    note: d._fromStep && !spec.noNote ? 'SFMC has no API for the details of this activity type; this is what the automation step holds.' : null,
    main,
    extra: [...extra, ...rest(d, used)],
    code: codeText ? { label: spec.code.label, text: String(codeText), lang: spec.code.lang } : null,
    tables: (spec.tables ? spec.tables(d) : []).filter(Boolean),
    // Data extensions behind main rows, by label, so the card can link them (feedback #36).
    deRefs: Object.fromEntries(Object.entries(spec.deRefs ? spec.deRefs(d) : {})
      .filter(([, r]) => r && typeof r.name === 'string' && r.name.trim())
      .map(([label, r]) => [label, { name: r.name, id: r.id || null, key: r.key || null }])),
    // A SQL Query activity that can be run (feedback #37).
    run: spec.run ? spec.run(d) : null,
    // Saved versions of a Query or Script activity (feedback #122).
    versionsKey: spec.versionsKey ? spec.versionsKey(d) : null,
    // Run once for data extracts, imports, file transfers and scripts (feedback #135).
    start: startTarget(typeId, d),
  }
}

const SPECS = {
  300: {
    link: (d, s) => AS_LINK(s, 'ActivityDetails', 300, d.queryDefinitionId),
    main: [['Description', 'description'], ['Target', 'targetName'], ['Update type', (d) => d.targetUpdateTypeName || UPDATE_TYPES[d.targetUpdateTypeId]]],
    extra: [['Query definition ID', 'queryDefinitionId'], ['Target ID', 'targetId'], ['Target key', 'targetKey'], ['Target description', 'targetDescription'],
      ['Update type ID', 'targetUpdateTypeId'], ['Created', 'createdDate'], ['Modified', 'modifiedDate'], ['Frozen', 'isFrozen']],
    alsoUsed: ['targetUpdateTypeName'],
    code: { key: 'queryText', label: 'SQL', lang: 'sql' },
    deRefs: (d) => ({ Target: { name: d.targetName, id: d.targetId, key: d.targetKey } }),
    run: (d) => (d.queryDefinitionId ? {
      queryDefinitionId: d.queryDefinitionId, sql: d.queryText || '', targetName: d.targetName || '',
      updateType: d.targetUpdateTypeName || UPDATE_TYPES[d.targetUpdateTypeId] || '',
    } : null),
    versionsKey: (d) => versionsKeyFor(300, d),
  },
  423: {
    link: (d, s) => AS_LINK(s, 'ActivityModal', 423, d.ssjsActivityId),
    main: [['Description', 'description']],
    extra: [['Key', 'key'], ['Script activity ID', 'ssjsActivityId'], ['Created', 'createdDate'], ['Modified', 'modifiedDate']],
    code: { key: 'script', label: 'Script', lang: 'javascript' },
    versionsKey: (d) => versionsKeyFor(423, d),
  },
  303: {
    link: (d, s) => AS_LINK(s, 'ActivityModal', 303, d.filterActivityId),
    main: [['Description', 'description'], ['Source', (d) => d.sourceObjectName || d.sourceObjectId], ['Result', (d) => d.resultDEName || d.destinationObjectName || d.resultDEKey]],
    deRefs: (d) => ({ Result: { name: d.resultDEName || d.destinationObjectName, key: d.resultDEKey } }),
    tables: (d) => [kvTable('Filter definition', d.additionalStepDetails)],
  },
  73: {
    link: (d, s) => AS_LINK(s, 'ActivityModal', 73, d.dataExtractDefinitionId),
    main: [['Description', 'description'], ['File spec', 'fileSpec'], ['Interval type', 'intervalType']],
    extra: [['Data extract definition ID', 'dataExtractDefinitionId'], ['Data extract type ID', 'dataExtractTypeId'], ['Created', 'createdDate'],
      ['Created by', 'createdBy'], ['Modified', 'modifiedDate'], ['Modified by', 'modifiedBy']],
    alsoUsed: ['dataFields'],
    tables: (d) => [nvtTable('Data fields', d.dataFields)],
  },
  53: {
    link: (d, s) => AS_LINK(s, 'ActivityDetails', 53, d.id),
    main: [['File spec', (d) => d.additionalStepDetails?.fileSpec ?? d.fileSpec], ['Upload', (d) => d.additionalStepDetails?.isUpload ?? d.isUpload],
      ['Encrypted', (d) => d.additionalStepDetails?.isEncrypted], ['PGP encrypted', (d) => d.additionalStepDetails?.isPgp],
      ['Compressed', (d) => d.additionalStepDetails?.isCompressed], ['File spec localized', (d) => d.additionalStepDetails?.isFileSpecLocalized]],
    extra: [['ID', 'id'], ['Customer key', 'customerKey'], ['Location ID', (d) => d.additionalStepDetails?.fileTransferLocationId], ['Created', 'createdDate'], ['Modified', 'modifiedDate']],
  },
  43: {
    link: (d, s) => AS_LINK(s, 'ActivityDetails', 43, d.importDefinitionId),
    main: [['Description', 'description'], ['File spec', 'fileSpec'], ['File naming pattern', 'fileNamingPattern'], ['Field mapping type', 'fieldMappingType'],
      ['Destination type', (d) => IMPORT_DESTINATIONS[d.destinationObjectTypeId] || d.destinationObjectTypeId], ['Target data extension', (d) => d.targetDataExtension?.name ?? d.targetDataExtension],
      ['Update type', (d) => UPDATE_TYPES[d.updateTypeId] || d.updateTypeId]],
    extra: [['Allow errors', 'allowErrors'], ['Customer key', 'customerKey'], ['Created', 'createdDate'], ['Modified', 'modifiedDate'], ['Date format locale', 'dateFormatLocale'],
      ['Delete file', 'deleteFile'], ['Destination ID', 'destinationObjectId'], ['File transfer location ID', 'fileTransferLocationId'], ['File type', 'fileType'],
      ['Notification email', 'notificationEmailAddress'], ['Send email notification', 'sendEmailNotification'], ['Subscriber import type ID', 'subscriberImportTypeId'],
      ['Max file age (hours)', 'maxFileAgeHours'], ['Max import frequency (hours)', 'maxImportFrequencyHours'], ['Standard quoted strings', 'standardQuotedStrings']],
    alsoUsed: ['destinationObjectTypeId', 'targetDataExtension', 'updateTypeId', 'fieldMappings', 'importDefinitionId'],
    deRefs: (d) => ({ 'Target data extension': typeof d.targetDataExtension === 'object' && d.targetDataExtension
      ? { name: d.targetDataExtension.name, id: d.targetDataExtension.id, key: d.targetDataExtension.customerKey ?? d.targetDataExtension.key }
      : { name: typeof d.targetDataExtension === 'string' ? d.targetDataExtension : '' } }),
    tables: (d) => [nvtTable('Field mappings', d.fieldMappings, true)],
  },
  42: {
    main: [['Description', 'description'], ['Subject', 'emailSubject'], ['From name', 'fromName'], ['From email', 'fromEmail'], ['Send classification', 'sendClassificationName']],
  },
  1000: {
    main: [['Description', 'description'], ['Condition', 'verificationCondition'], ['Verification type', 'verificationType']],
  },
  467: {
    noNote: true,
    extra: [['ID', 'id'], ['Activity object ID', 'activityObjectId']],
    tables: (d) => [Array.isArray(d.serializedObject) ? nvtTable('Wait settings', d.serializedObject)
      : d.serializedObject ? { title: 'Wait settings', columns: ['Value'], rows: [[formatValue(d.serializedObject)]] } : null],
  },
  952: {
    noNote: true,
    main: [['Activity object ID', 'activityObjectId'], ['Activity ID', 'id'], ['Display order', 'displayOrder']],
  },
  425: {
    link: (d, s) => (d.eltActivityId ? automationStudioUrl(s) : null),
    main: [['Description', 'description'], ['Status', 'status']],
    extra: [['ELT activity ID', 'eltActivityId'], ['Key', 'key'], ['Status ID', 'statusId'], ['Category ID', 'categoryId'],
      ['Created', 'createdDate'], ['Created by', 'createdBy'], ['Modified', 'modifiedDate'], ['Modified by', 'modifiedBy']],
  },
}

/** Display data for one activity's details (see the top of this file). */
export function describeActivity(objectTypeId, details, stack) {
  const spec = SPECS[objectTypeId]
  if (spec) return build(details, objectTypeId, stack, spec)
  // Every other type (and the 8 types Automation Viewer had no view for): all fields.
  const d = details || {}
  const all = Object.entries(d).filter(([k]) => k !== 'name' && !STEP_FIELDS.has(k)).map(([k, v]) => [humanize(k), formatValue(v)])
  return {
    typeLabel: activityTypeLabel(objectTypeId),
    title: d.name || activityTypeLabel(objectTypeId),
    link: null,
    note: d._fromStep ? 'SFMC has no API for the details of this activity type; this is what the automation step holds.' : null,
    main: all,
    extra: [],
    code: null,
    tables: [],
    deRefs: {},
    run: null,
  }
}

/** Export blocks (utils/exportDoc.js) for one described activity. */
export function activityBlocks(desc, heading, level = 3) {
  return [
    { type: 'h', level, text: heading ? `${heading}: ${desc.title}` : desc.title },
    { type: 'kv', rows: [['Type', desc.typeLabel], ...desc.main, ...desc.extra] },
    ...(desc.code ? [{ type: 'code', text: desc.code.text, lang: desc.code.lang === 'javascript' ? 'javascript' : 'sql' }] : []),
    ...desc.tables.flatMap((t) => [{ type: 'p', text: t.title }, { type: 'table', columns: t.columns, rows: t.rows }]),
  ]
}
