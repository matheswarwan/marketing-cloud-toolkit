// Save results to a data extension (from SQL Studio's "Save to DE"): the rows loaded in
// Run Query's results go into an existing data extension (Append, or Update by primary
// key) or a new one made from the query's columns. Uses the async rows API, so SFMC adds
// the rows in the background after the call returns.
import { insertDERowsAsync, upsertDERowsAsync, createTargetDE } from './sfmcApi.js'

export const SAVE_BATCH = 500
const lc = (s) => String(s || '').toLowerCase()

/**
 * Rows keyed by the target's field names (the results have lower-case keys), and the
 * result columns the target has no field for.
 */
export function mapRows(rows = [], targetFields = []) {
  const byLower = new Map(targetFields.map((f) => [lc(f.name), f.name]))
  const dropped = new Set()
  const items = rows.map((r) => {
    const o = {}
    for (const [k, v] of Object.entries(r || {})) {
      const name = byLower.get(lc(k))
      if (name) o[name] = v ?? ''
      else dropped.add(k)
    }
    return o
  })
  return { items, dropped: [...dropped] }
}

/**
 * @param {string} stack
 * @param {object} p
 * @param {{ key, name, fields }} [p.target]  an existing DE
 * @param {{ name, categoryID, fields }} [p.create]  a new DE to make first
 * @param {Array} p.rows
 * @param {'append'|'upsert'} p.mode
 * @param {(done:number,total:number)=>void} [p.onProgress]
 * Returns { de: { key, name, id, created }, sent, dropped }.
 */
export async function saveResultsToDE(stack, { target, create, rows, mode = 'append', onProgress }, api = { insertDERowsAsync, upsertDERowsAsync, createTargetDE }) {
  let de = target
  if (create) {
    const made = await api.createTargetDE(stack, { name: create.name, fields: create.fields, categoryID: create.categoryID })
    de = { id: made.id, key: made.customerKey, name: create.name, fields: create.fields, created: true }
  }
  if (!de?.key) throw new Error('The data extension has no external key.')
  const { items, dropped } = mapRows(rows, de.fields || [])
  const send = mode === 'upsert' ? api.upsertDERowsAsync : api.insertDERowsAsync
  let sent = 0
  for (let i = 0; i < items.length; i += SAVE_BATCH) {
    const batch = items.slice(i, i + SAVE_BATCH)
    await send(stack, de.key, batch)
    sent += batch.length
    onProgress?.(sent, items.length)
  }
  return { de, sent, dropped }
}
