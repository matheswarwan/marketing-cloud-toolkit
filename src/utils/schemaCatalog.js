import { DATA_VIEWS, DATA_VIEW_FIELDS } from './dataViews.js'
import { searchDEsAllSources, fetchDEMetadata, fetchDEFieldsCached, resolveFieldType } from './sfmcApi.js'

// Table and field names for the editor's autocomplete and lint rules.
// Data views come from the built-in list; Data Extensions are looked up live
// with the same APIs the run flow uses (global DE search plus Shared and
// Synchronized DEs, then the DE's fields)
// and cached per stack. Every lookup degrades to "nothing known" on error, so
// the editor never waits on or breaks because of the API.

const SEARCH_TTL = 2 * 60 * 1000
const FIELDS_TTL = 10 * 60 * 1000

const DATA_VIEW_NAMES = [...new Set(DATA_VIEWS)]

/** `ENT.[My DE]` → `My DE`; `[x]` → `x`. */
export function bareTableName(name) {
  return String(name || '').trim().replace(/^ent\s*\.\s*/i, '').replace(/^\[(.*)\]$/s, '$1').replace(/]]/g, ']')
}

export function createSchemaCatalog(getStack) {
  const searches = new Map()   // `${stack}|${prefix}` → { ts, items }
  const fields   = new Map()   // `${stack}|${lowerName}` → { ts, name, fields, promise? }
  const missing  = new Map()   // `${stack}|${lowerName}` → ts: the exact-name DE lookup found nothing
  const listeners = new Set()

  const stack = () => (typeof getStack === 'function' ? getStack() : getStack) || null

  function dataViewFields(name) {
    const list = DATA_VIEW_FIELDS[bareTableName(name).toUpperCase()]
    return list ? list.map(f => ({ name: f.name, type: f.type })) : null
  }

  /** Data views plus DEs whose name contains `prefix` (API search for 2+ characters). */
  async function searchTables(prefix) {
    const p = (prefix || '').toLowerCase()
    const views = DATA_VIEW_NAMES
      .filter(n => n.toLowerCase().includes(p))
      .map(n => ({ name: n, kind: 'dataview' }))
    const s = stack()
    if (!s || p.replace(/^_/, '').length < 2 || p.startsWith('_')) return views
    const key = `${s}|${p}`
    let hit = searches.get(key)
    if (!hit || Date.now() - hit.ts > SEARCH_TTL) {
      try {
        const data = await searchDEsAllSources(s, p, 50)
        hit = { ts: Date.now(), items: (data?.items || []).map(de => ({ name: de.name, kind: 'de', key: de.key, id: de.id, sourceType: de.sourceType || null })) }
        searches.set(key, hit)
        // A search result gives the DE id, so a later field lookup can skip the name search.
        for (const de of hit.items) {
          const fk = `${s}|${de.name.toLowerCase()}`
          if (!fields.has(fk)) fields.set(fk, { ts: 0, name: de.name, id: de.id, fields: null })
        }
      } catch {
        hit = { ts: Date.now(), items: [] }
      }
    }
    return [...views, ...hit.items]
  }

  /** Fields of a data view or DE, or [] when unknown. */
  async function fieldsFor(tableName) {
    const dv = dataViewFields(tableName)
    if (dv) return dv
    const s = stack()
    const name = bareTableName(tableName)
    if (!s || !name) return []
    const key = `${s}|${name.toLowerCase()}`
    const hit = fields.get(key)
    if (hit?.fields && Date.now() - hit.ts < FIELDS_TTL) return hit.fields
    if (hit?.promise) return hit.promise
    const promise = (async () => {
      try {
        const id = hit?.id ?? (await fetchDEMetadata(s, name)).id
        const data = await fetchDEFieldsCached(s, id)
        const list = (data?.fields || []).map(f => ({ name: f.name, type: resolveFieldType(f.type) }))
        fields.set(key, { ts: Date.now(), name, id, fields: list })
        missing.delete(key)
        listeners.forEach(fn => fn())
        return list
      } catch (err) {
        fields.set(key, { ts: Date.now(), name, fields: [] })
        // Only a definite "not found" from the exact-name lookup counts as missing;
        // a network or session error says nothing about the table.
        if (/^DE not found/.test(err?.message || '')) {
          missing.set(key, Date.now())
          listeners.forEach(fn => fn())
        }
        return []
      }
    })()
    fields.set(key, { ...(hit || {}), name, promise })
    return promise
  }

  /** Whatever is already known, synchronously: { [lowerName]: { name, fields } } for lint rules. */
  function knownTables() {
    const out = {}
    for (const [n, list] of Object.entries(DATA_VIEW_FIELDS)) {
      out[n.toLowerCase()] = { name: n, fields: list.map(f => ({ name: f.name, type: f.type })) }
    }
    const s = stack()
    for (const [key, v] of fields) {
      if (s && key.startsWith(s + '|') && v.fields?.length) out[key.slice(s.length + 1)] = { name: v.name, fields: v.fields }
    }
    // Tables confirmed missing on this stack, for the unknown-table rule (QS034).
    const gone = new Set()
    for (const [key, ts] of missing) {
      if (s && key.startsWith(s + '|') && Date.now() - ts < FIELDS_TTL) gone.add(key.slice(s.length + 1))
    }
    Object.defineProperty(out, '__missing', { value: gone, enumerable: false })
    return out
  }

  /** Called whenever new fields arrive (the editor re-lints). Returns an unsubscribe function. */
  function onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { searchTables, fieldsFor, knownTables, onChange }
}
