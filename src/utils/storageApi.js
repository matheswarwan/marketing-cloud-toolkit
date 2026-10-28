// Data extension storage (feedback #68): the calls Contact Builder's storage screen
// makes, from the user's network log. storageDetails lists every data extension
// with its rows and size; storageHistory gives one total per day. Host
// mc-data-ui.<stack>.marketingcloudapps.com (app `dataUi` in background/apps.js,
// covered by the existing *.marketingcloudapps.com permission). Not yet checked
// against a live org through the extension.
import { sfmcFetch } from './sfmcApi.js'
import { csvQuote } from './queryCsv.js'

const DATA_UI = (stack) => `https://mc-data-ui.${stack}.marketingcloudapps.com/fuelapi/data/v1/customobjects`

// MM-DD-YYYY, the date format storageHistory takes.
export function mdY(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()}`
}

export async function fetchStorageDetails(stack) {
  const data = await sfmcFetch(`${DATA_UI(stack)}/storageDetails`, 'GET')
  const items = (data?.items || []).map((r) => ({
    key: r.externalKey || `${r.mID}:${r.dataExtensionName}`,
    name: r.dataExtensionName || '',
    path: r.dataExtensionPath || '',
    businessUnit: r.businessUnitName || '',
    mid: r.mID ?? null,
    rows: Number(r.recordCount) || 0,
    gb: Number(r.usedGB) || 0,
    sendable: !!r.isSendable,
    retention: r.dataRetentionPolicy || '',
    type: r.type || '',
    externalKey: r.externalKey || '',
    found: r.storageInfoFound !== false,
    sampleDate: r.sampleDate || '',
  }))
  return { items, total: Number(data?.count ?? items.length) }
}

export async function fetchStorageHistory(stack, days = 30, now = new Date()) {
  const start = new Date(now.getTime() - days * 86400000)
  const data = await sfmcFetch(`${DATA_UI(stack)}/storageHistory?startDate=${mdY(start)}&endDate=${mdY(now)}`, 'GET')
  return (data?.items || []).map((d) => ({
    key: String(d.date || '').slice(0, 10),
    gb: Number(d.totalGB) || 0,
    rows: Number(d.totalRowCount) || 0,
    count: Number(d.count) || 0,
  })).filter((d) => d.key).sort((a, b) => a.key.localeCompare(b.key))
}

// Feedback #125: storageDetails and storageHistory answer only in the parent
// (Enterprise) business unit; from a child BU they fail.
export const PARENT_BU_ONLY = 'Data extension storage is only available from the parent (Enterprise) business unit. Switch to it in SFMC, then click Refresh.'

/**
 * What to tell the user when the storage calls fail: `{ notice, detail }`. In a
 * child BU (or when the BU is unknown) the likely cause is the BU, so the notice
 * says to switch; the raw error is kept for a folded details block.
 */
export function storageFailureNotice(error, bu) {
  const detail = String(error?.message || error || '')
  if (bu?.isChild === true) return { notice: `You are in ${bu.name ? `"${bu.name}", ` : ''}a child business unit. ${PARENT_BU_ONLY}`, detail, childBU: true }
  if (bu?.isChild === false) return { notice: 'Could not read data extension storage. Open Contact Builder once in SFMC, then click Refresh, or read row counts below.', detail, childBU: false }
  return { notice: 'Could not read data extension storage. It is only available from the parent (Enterprise) business unit: if you are in a child BU, switch to the parent in SFMC, then click Refresh. Otherwise open Contact Builder once in SFMC, then Refresh.', detail, childBU: null }
}

/** Totals by business unit, largest first. */
export function byBusinessUnit(items) {
  const m = new Map()
  for (const d of items) {
    const k = d.businessUnit || String(d.mid ?? '')
    const t = m.get(k) || { businessUnit: k, gb: 0, rows: 0, count: 0 }
    t.gb += d.gb; t.rows += d.rows; t.count++
    m.set(k, t)
  }
  return [...m.values()].sort((a, b) => b.gb - a.gb)
}

export const formatGB = (gb) => (gb >= 100 ? gb.toFixed(0) : gb >= 1 ? gb.toFixed(1) : gb >= 0.01 ? gb.toFixed(2) : gb > 0 ? '<0.01' : '0')

/** CSV of the listed data extensions. */
export function storageDetailsCsv(items) {
  const head = ['Name', 'Path', 'Business unit', 'MID', 'Rows', 'GB', 'Retention', 'Sendable', 'Type', 'External key', 'Sampled']
  const lines = items.map((d) => [d.name, d.path, d.businessUnit, d.mid ?? '', d.rows, d.found ? d.gb : '', d.retention, d.sendable ? 'Yes' : 'No', d.type, d.externalKey, d.sampleDate].map(csvQuote).join(','))
  return [head.map(csvQuote).join(','), ...lines].join('\r\n')
}
