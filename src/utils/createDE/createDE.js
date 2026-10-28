// Create DE (feedback #94): field and setting rules, the request SFMC gets, and
// loading the sample rows. The page is views/data/CreateDEPage.vue.
import { createDataExtension, insertDERowsAsync, DEFAULT_TEXT_LENGTH } from '../sfmcApi.js'
import { isBoolText, isDateText, isEmailText, isIntText } from './sample.js'

// SFMC field types. The body sends them as numbers, the way Contact Builder's own
// Create screen does (the user's capture, 2026-10-25: EmailAddress is type 4 with
// length 254, Number type 1 with length null, scale 0 on every field). 2.0.13 sent
// names ('EmailAddress' with no length), which SFMC refused for EmailAddress
// (feedbacks #131, #134). `fixedLength` is the length SFMC gives a type itself.
// The names are sent once more only when SFMC refuses a type.
export const FIELD_TYPES = [
  { id: 'Text', num: 0, length: true },
  { id: 'Number', num: 1 },
  { id: 'Decimal', num: 6, length: true, scale: true },
  { id: 'Date', num: 2 },
  { id: 'Boolean', num: 3 },
  { id: 'EmailAddress', num: 4, fixedLength: 254 },
  { id: 'Phone', num: 5 },
  { id: 'Locale', num: 7 },
]
const TYPE = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]))

// "Current date" default for Date fields (feedback #133), as SFMC stores it for the
// Current date option in Contact Builder. Not checked live.
export const CURRENT_DATE_DEFAULT = 'getdate()'

// Data retention: what is deleted, and the period units (SFMC's unit numbers).
export const RETENTION_MODES = [
  { id: 'off', label: 'Off' },
  { id: 'rows', label: 'Delete individual records' },
  { id: 'all', label: 'Delete all records' },
  { id: 'allAndDE', label: 'Delete all records and the data extension' },
]
export const RETENTION_UNITS = [
  { id: 3, label: 'days' },
  { id: 4, label: 'weeks' },
  { id: 5, label: 'months' },
  { id: 6, label: 'years' },
]

export const MAX_FIELDS = 4000
export const LOAD_BATCH = 500
const NAME_CHARS = /^[A-Za-z0-9_ ]+$/
const DE_NAME_CHARS = /^[A-Za-z0-9_ -]+$/
const KEY_CHARS = /^[A-Za-z0-9_-]+$/

export function blankField(n = 1) {
  return { name: `Field${n}`, type: 'Text', length: 255, scale: 0, isPrimaryKey: false, isNullable: true, defaultValue: '', currentDate: false }
}

export function blankSettings() {
  return {
    name: '', key: '', description: '', folderId: null, folderPath: '',
    isSendable: false, sendField: '', isTestable: false,
    retention: { mode: 'off', length: 30, unit: 3, resetOnImport: false },
  }
}

/** Problems with one field ('' when fine), given every field for the name check. */
export function fieldProblem(f, all = []) {
  const name = String(f.name ?? '').trim()
  if (!name) return 'Enter a name.'
  if (name.length > 128) return 'Names are at most 128 characters.'
  if (!NAME_CHARS.test(name)) return 'Use letters, numbers, spaces and underscores only.'
  if (name.startsWith('_')) return 'Names starting with an underscore are kept for SFMC.'
  if (all.filter((g) => String(g.name ?? '').trim().toLowerCase() === name.toLowerCase()).length > 1) return 'Two fields have this name.'
  if (!TYPE[f.type]) return 'Pick a type.'
  if (f.type === 'Text' && f.length !== '' && f.length != null) {
    const n = Number(f.length)
    if (!Number.isInteger(n) || n < 1 || n > 4000) return 'Text length is 1 to 4000 (empty: 4000).'
  }
  if (f.type === 'Decimal') {
    const p = Number(f.length)
    const s = Number(f.scale)
    if (!Number.isInteger(p) || p < 1 || p > 38) return 'Decimal length (precision) is 1 to 38.'
    if (!Number.isInteger(s) || s < 0 || s > p) return 'Decimal places are 0 to the length.'
  }
  if (f.isPrimaryKey && f.isNullable) return 'A primary key field must be required.'
  const d = String(f.defaultValue ?? '')
  if (d && !usesCurrentDate(f) && valueProblem(d, f)) return `Default value: ${valueProblem(d, f)}`
  return ''
}

/** Why a value does not fit a field ('' when it does). Empty values are checked by cellProblem. */
export function valueProblem(value, f) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  switch (f.type) {
    case 'Text': return f.length && v.length > Number(f.length) ? `Longer than ${f.length} characters` : ''
    case 'Number': return isIntText(v) ? '' : 'Not a whole number'
    case 'Decimal': {
      if (!/^[-+]?\d+(\.\d+)?$/.test(v)) return 'Not a number'
      const [i, frac = ''] = v.replace(/^[-+]/, '').split('.')
      if (frac.length > Number(f.scale)) return `More than ${f.scale} decimal places`
      if (i.replace(/^0+(?=\d)/, '').length > Number(f.length) - Number(f.scale)) return 'Too many digits'
      return ''
    }
    case 'Date': return isDateText(v) ? '' : 'Not a date'
    case 'Boolean': return isBoolText(v) ? '' : 'Not true or false'
    case 'EmailAddress': return isEmailText(v) && v.length <= 254 ? '' : 'Not an email address'
    case 'Phone': return /^[0-9+().\s-]{3,50}$/.test(v) ? '' : 'Not a phone number'
    case 'Locale': return /^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(v) ? '' : 'Not a locale (like en-US)'
    default: return ''
  }
}

/** Why a sample cell would be refused ('' when fine). */
const usesCurrentDate = (f) => f.type === 'Date' && !!f.currentDate

export function cellProblem(value, f) {
  if (String(value ?? '').trim() === '') return f.isNullable || usesCurrentDate(f) || String(f.defaultValue ?? '') ? '' : 'Required'
  return valueProblem(value, f)
}

/** Problems with the settings and fields together: { form: [...], fields: [...] }. */
export function checkCreateForm(settings, fields) {
  const form = []
  const name = String(settings.name ?? '').trim()
  if (!name) form.push('Enter a name for the data extension.')
  else if (name.length > 128) form.push('The data extension name is at most 128 characters.')
  else if (!DE_NAME_CHARS.test(name) || name.startsWith('_')) form.push('Use letters, numbers, spaces, underscores and dashes in the name (not starting with an underscore).')
  const key = String(settings.key ?? '').trim()
  if (key && (key.length > 36 || !KEY_CHARS.test(key))) form.push('The external key is up to 36 letters, numbers, underscores or dashes (or leave it empty).')
  if (settings.folderId == null || settings.folderId === '') form.push('Pick a folder.')
  if (!fields.length) form.push('Add at least one field.')
  if (fields.length > MAX_FIELDS) form.push(`A data extension has at most ${MAX_FIELDS} fields.`)
  if (settings.isSendable) {
    const f = fields.find((x) => x.name === settings.sendField)
    if (!f) form.push('Pick the field that relates to Subscriber Key.')
    else if (!['Text', 'EmailAddress', 'Number'].includes(f.type)) form.push('The send relationship field must be Text, EmailAddress or Number.')
  }
  const r = settings.retention || {}
  if (r.mode && r.mode !== 'off') {
    const n = Number(r.length)
    if (!Number.isInteger(n) || n < 1 || n > 999) form.push('The retention period is 1 to 999.')
  }
  return { form, fields: fields.map((f) => fieldProblem(f, fields)) }
}

export function isFormValid(check) {
  return !check.form.length && check.fields.every((p) => !p)
}

/**
 * The fields array SFMC gets, in Contact Builder's own shape: numeric type, `length`
 * (Text's length, EmailAddress 254, Decimal's precision, else null), `scale` (Decimal's
 * places, else 0) and `defaultValue` (null when none). `{ named: true }` sends type
 * names with length only on Text and Decimal (2.0.13's shape), for the one retry.
 */
export function buildFields(fields, { named = false } = {}) {
  return fields.map((f, i) => {
    const t = TYPE[f.type] || TYPE.Text
    const field = {
      name: String(f.name).trim(),
      ordinal: i,
      type: named ? t.id : t.num,
      isPrimaryKey: !!f.isPrimaryKey,
      isTemplateField: false, isHidden: false, isReadOnly: false, isOverridable: false, isInheritable: false,
      updatable: true, retrievable: true, isActive: true, mustOverride: false,
      isNullable: f.isPrimaryKey ? false : !!f.isNullable,
    }
    // Text with an empty length gets SFMC's maximum.
    const textLength = f.length !== '' && f.length != null ? Number(f.length) : DEFAULT_TEXT_LENGTH
    if (named) {
      if (t.num === 0) field.length = textLength
      if (t.num === 6) { field.length = Number(f.length); field.scale = Number(f.scale) }
    } else {
      field.length = t.num === 0 ? textLength : t.num === 6 ? Number(f.length) : (t.fixedLength ?? null)
      field.scale = t.num === 6 ? Number(f.scale) : 0
      field.defaultValue = null
    }
    const d = usesCurrentDate(f) ? CURRENT_DATE_DEFAULT : String(f.defaultValue ?? '').trim()
    if (d) field.defaultValue = d
    return field
  })
}

export function retentionBody(r) {
  if (!r || !r.mode || r.mode === 'off') return null
  return {
    isRowBasedRetention: r.mode === 'rows',
    isDeleteAtEndOfRetentionPeriod: r.mode === 'allAndDE',
    isResetRetentionPeriodOnImport: !!r.resetOnImport,
    dataRetentionPeriodLength: Number(r.length),
    dataRetentionPeriodUnitOfMeasure: Number(r.unit),
  }
}

/** An SFMC refusal about a field's type that the type names might fix. */
export function isTypeRefusal(message) {
  const m = String(message || '')
  return /\btype\b/i.test(m) && !lengthErrorField(m)
}

/**
 * The field SFMC names in "Length is invalid for field <name> because it does not
 * have a data type of Text" (feedback #131: an EmailAddress primary key), else null.
 */
export function lengthErrorField(message) {
  const m = String(message || '').match(/Length is invalid for field (.+?) because it does not have a data type of Text/i)
  return m ? m[1].trim() : null
}

/** The body for Contact Builder's customobjects POST. */
export function buildCreateBody(settings, fields, { named = false } = {}) {
  const body = {
    importActivity: {},
    name: String(settings.name).trim(),
    description: String(settings.description ?? '').trim(),
    categoryID: Number.parseInt(settings.folderId, 10),
    isActive: true,
    status: 0,
    isObjectDeletable: true,
    isFieldAdditionAllowed: true,
    isFieldModificationAllowed: true,
    isTestable: !!settings.isTestable,
    isSendable: !!settings.isSendable,
    fields: buildFields(fields, { named }),
  }
  const key = String(settings.key ?? '').trim()
  if (key) body.customerKey = key
  if (settings.isSendable) {
    body.sendableCustomObjectField = settings.sendField
    body.sendableSubscriberField = '_SubscriberKey'
  }
  const ret = retentionBody(settings.retention)
  if (ret) body.dataRetentionProperties = ret
  return body
}

/** Sample rows as SFMC row objects, skipping rows with a problem. { items, skipped } */
export function rowsToLoad(fields, rows, columnIndex) {
  const items = []
  let skipped = 0
  for (const r of rows) {
    const item = {}
    let bad = false
    fields.forEach((f, i) => {
      const src = columnIndex[i]
      const v = src == null ? '' : String(r[src] ?? '').trim()
      if (cellProblem(v, f)) bad = true
      if (v !== '') item[String(f.name).trim()] = f.type === 'Boolean' ? String(/^(true|yes|y)$/i.test(v)) : v
    })
    if (bad) skipped++
    else items.push(item)
  }
  return { items, skipped }
}

/**
 * Creates the data extension; with `rows`, then adds them in batches of LOAD_BATCH.
 * Returns { de: { id, key, name }, loaded, skipped, loadError }.
 */
export async function createDE(stack, settings, fields, { rows = null, columnIndex = [], api = { createDataExtension, insertDERowsAsync } } = {}) {
  const check = checkCreateForm(settings, fields)
  if (!isFormValid(check)) throw new Error(check.form[0] || check.fields.find(Boolean))
  let created
  try {
    created = await api.createDataExtension(stack, buildCreateBody(settings, fields))
  } catch (e) {
    // When SFMC refuses a type, try once more with the type names.
    if (!isTypeRefusal(e?.message)) throw e
    created = await api.createDataExtension(stack, buildCreateBody(settings, fields, { named: true }))
  }
  const de = { id: created?.id, key: created?.customerKey || String(settings.key ?? '').trim(), name: String(settings.name).trim() }
  const out = { de, loaded: 0, skipped: 0, loadError: '' }
  if (!rows?.length) return out
  const { items, skipped } = rowsToLoad(fields, rows, columnIndex)
  out.skipped = skipped
  if (!de.key) { out.loadError = 'SFMC did not return the new data extension\'s key, so no rows were added.'; return out }
  try {
    for (let i = 0; i < items.length; i += LOAD_BATCH) {
      await api.insertDERowsAsync(stack, de.key, items.slice(i, i + LOAD_BATCH))
      out.loaded += Math.min(LOAD_BATCH, items.length - i)
    }
  } catch (e) {
    out.loadError = e.message
  }
  return out
}

// ── The folder used last, per stack and business unit ──
const FOLDER_KEY = 'toolkit_createDE_folders'

export async function readLastFolder(stack, buId) {
  try {
    const r = await chrome.storage.local.get(FOLDER_KEY)
    return r?.[FOLDER_KEY]?.[`${stack}:${buId ?? ''}`] || null
  } catch {
    return null
  }
}

export async function saveLastFolder(stack, buId, folder) {
  try {
    const r = await chrome.storage.local.get(FOLDER_KEY)
    const all = { ...(r?.[FOLDER_KEY] || {}), [`${stack}:${buId ?? ''}`]: { id: folder.id, path: folder.path } }
    await chrome.storage.local.set({ [FOLDER_KEY]: all })
  } catch { /* storage unavailable */ }
}
