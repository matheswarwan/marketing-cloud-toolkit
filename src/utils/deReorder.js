// Reorder a data extension's columns (feedback #1013). Contact Builder has no way to
// do it, so there are two routes: change each field's ordinal in place (Contact
// Builder's own field update, not confirmed to accept a new order: the order is read
// again afterwards to see whether it took), else a copy of the DE with the fields in
// the new order, filled from the original by a query activity. The original is never
// changed or deleted by the copy route.
import { sfmcFetch, createDataExtension, getOrCreateQAFolder, createQueryActivity, startQueryActivity, getQueryActivityStatus, deleteQueryActivity } from './sfmcApi.js'
import { fetchDEDetail, deRowCountOf, clearDECaches } from './deApi.js'
import { createDE, FIELD_TYPES, CURRENT_DATE_DEFAULT } from './createDE/createDE.js'
import { sqlName } from './format.js'

const CM = (stack) => `https://mc.${stack}.exacttarget.com/cloud/fuelapi`

/** Fields in the DE's own order (ordinal), not primary keys first as the page lists them. */
export function fieldsInOrder(list = []) {
  return list.map((f, i) => ({ f, i }))
    .sort((a, b) => ((a.f.ordinal ?? a.i) - (b.f.ordinal ?? b.i)) || a.i - b.i)
    .map((x) => x.f)
}

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice()
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const sameOrder = (a = [], b = []) => a.length === b.length && a.every((f, i) => f.name === b[i]?.name)

/** Reads the DE's fields in ordinal order, uncached. */
export async function readFieldOrder(stack, id) {
  const data = await sfmcFetch(`${CM(stack)}/internal/v1/customobjects/${encodeURIComponent(id)}/fields`, 'GET')
  if (!Array.isArray(data?.fields)) throw new Error('No fields in the response.')
  return fieldsInOrder(data.fields)
}

/**
 * Tries the new order in place: every field goes back exactly as SFMC gave it, with
 * only `ordinal` changed. Returns { applied, error, order } where `order` is what SFMC
 * has afterwards.
 */
export async function reorderInPlace(stack, de, ordered, api = { sfmcFetch, readFieldOrder }) {
  const fields = ordered.map((f, i) => ({ ...f, ordinal: i }))
  let error = ''
  try {
    await api.sfmcFetch(`${CM(stack)}/internal/v1/customobjects/${encodeURIComponent(de.id)}`, 'PATCH', { id: de.id, fields })
  } catch (e) {
    error = e.message || String(e)
  }
  clearDECaches()
  const order = await api.readFieldOrder(stack, de.id).catch(() => null)
  return { applied: !!order && sameOrder(order, ordered), error, order }
}

const TYPE_IDS = new Set(FIELD_TYPES.map((t) => t.id))
const TYPE_BY_NUM = Object.fromEntries(FIELD_TYPES.map((t) => [t.num, t.id]))

/** A field as SFMC reads it, in Create DE's form (utils/createDE/createDE.js). */
export function toCreateField(f) {
  const type = TYPE_IDS.has(f.type) ? f.type : (TYPE_BY_NUM[f.type] ?? 'Text')
  const d = f.defaultValue == null ? '' : String(f.defaultValue)
  const currentDate = type === 'Date' && /^getdate\(\)$/i.test(d.trim())
  return {
    name: f.name,
    type,
    length: type === 'Text' || type === 'Decimal' ? (f.length ?? '') : '',
    scale: type === 'Decimal' ? (f.scale ?? 0) : 0,
    isPrimaryKey: !!f.isPrimaryKey,
    isNullable: f.isPrimaryKey ? false : f.isNullable !== false,
    defaultValue: currentDate ? '' : d,
    currentDate,
  }
}

/** Name for the copy: "<name>_Reordered", cut to SFMC's 128 characters. */
export function copyName(name) {
  const suffix = '_Reordered'
  return String(name).slice(0, 128 - suffix.length) + suffix
}

/** Settings for the copy from the original's record: folder, description, sendable, testable. */
export function copySettings(de, detail = {}, name = copyName(de.name)) {
  const sendField = detail.sendableCustomObjectField || detail.sendableDataExtensionField?.name || ''
  return {
    name,
    key: '',
    description: detail.description ?? de.description ?? '',
    folderId: detail.categoryID ?? detail.categoryId ?? de.categoryId,
    folderPath: '',
    isSendable: !!detail.isSendable && !!sendField,
    sendField,
    isTestable: !!detail.isTestable,
    retention: { mode: 'off', length: 30, unit: 3, resetOnImport: false },
  }
}

/** The SQL that fills the copy: every column, in the new order. */
export function copySql(deName, ordered, { shared = false } = {}) {
  return `SELECT ${ordered.map((f) => sqlName(f.name)).join(', ')}\nFROM ${shared ? 'ENT.' : ''}${sqlName(deName)}`
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Creates the copy and fills it: create the DE, create a query activity (Overwrite) in
 * the QuerySaver folder, start it, wait for it, delete the activity, compare row counts.
 * `onStep(text)` reports progress. Returns { de, rows, sourceRows, activityLeft }.
 */
export async function copyInNewOrder(stack, de, ordered, { name, onStep = () => {}, pollMs = 5000, maxMinutes = 60, api } = {}) {
  const a = {
    fetchDEDetail, createDE, getOrCreateQAFolder, createQueryActivity, startQueryActivity,
    getQueryActivityStatus, deleteQueryActivity, wait, ...api,
  }
  onStep('Reading the data extension\'s settings')
  const detail = await a.fetchDEDetail(stack, de.id)
  const settings = copySettings(de, detail, name || copyName(de.name))
  onStep(`Creating "${settings.name}"`)
  const { de: copy } = await a.createDE(stack, settings, ordered.map(toCreateField))
  if (!copy?.key || !copy?.id) throw new Error(`"${settings.name}" was created, but SFMC did not return its key, so no rows were copied.`)

  onStep('Creating a query activity to copy the rows')
  const categoryId = await a.getOrCreateQAFolder(stack)
  const qa = await a.createQueryActivity(stack, {
    name: `TK_Reorder_${Date.now()}`,
    description: `Copies ${de.name} into ${settings.name} (SFMC Toolkit, reorder columns)`,
    queryText: copySql(de.name, ordered, { shared: !!de.sourceType }),
    targetName: settings.name, targetKey: copy.key, targetId: copy.id,
    updateType: 0, categoryId,
  })
  const qaId = qa?.queryDefinitionId || qa?.id
  if (!qaId) throw new Error('SFMC did not return the query activity\'s ID.')

  // A copy still running is left alone (deleting its activity would not stop it).
  let activityLeft = false
  try {
    onStep('Copying the rows')
    await a.startQueryActivity(stack, qaId)
    let seenRunning = false
    const end = Date.now() + maxMinutes * 60000
    for (let i = 0; ; i++) {
      await a.wait(pollMs)
      const { isRunning } = await a.getQueryActivityStatus(stack, qaId)
      if (isRunning === true) seenRunning = true
      if (isRunning === false && (seenRunning || i >= 3)) break
      if (Date.now() > end) {
        activityLeft = true
        throw new Error(`The copy was still running after ${maxMinutes} minutes. Its query activity is left in Automation Studio's QuerySaver folder.`)
      }
    }
  } finally {
    if (!activityLeft) await a.deleteQueryActivity(stack, qaId).catch(() => { activityLeft = true })
  }

  onStep('Comparing row counts')
  const [rows, sourceRows] = await Promise.all([
    a.fetchDEDetail(stack, copy.id).then(deRowCountOf).catch(() => null),
    Promise.resolve(detail).then(deRowCountOf).catch(() => null),
  ])
  return { de: { ...copy, name: settings.name }, rows, sourceRows, activityLeft, sendableDropped: !!detail.isSendable && !settings.isSendable }
}
