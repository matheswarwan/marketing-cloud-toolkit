// Opening SQL in the Query Builder: finds each table of the query in SFMC (data views
// by name, Shared DEs for ENT., else a local DE named exactly so, else a Shared DE)
// and builds the builder state with sqlToBuilder.
import { DATA_VIEWS, DATA_VIEW_FIELDS } from './dataViews.js'
import { searchLocalDEsByName, findSharedDE, fetchDEFieldsCached } from './sfmcApi.js'
import { parseSqlForBuilder, builderFromParsed, splitSetOperations } from './sqlToBuilder.js'

const DV_BY_UPPER = new Map([...DATA_VIEWS].map((n) => [n.toUpperCase(), n]))

export async function resolveTableForBuilder(stack, t) {
  if (t.dataView) {
    const name = DV_BY_UPPER.get(String(t.name).toUpperCase()) || t.name
    return { id: `dv:${name}`, name, sourceType: 'dataview', isDataView: true, fields: DATA_VIEW_FIELDS[name.toUpperCase()] || [] }
  }
  if (!stack) return null
  const want = String(t.name).toLowerCase()
  let de = null
  if (t.ent) {
    const s = await findSharedDE(stack, t.name).catch(() => null)
    if (s) de = { ...s, sourceType: s.sourceType || 'shared' }
  }
  if (!de) {
    const local = await searchLocalDEsByName(stack, t.name).catch(() => ({ items: [] }))
    const hit = (local?.items || []).find((d) => String(d.name).toLowerCase() === want)
    if (hit) de = { ...hit, sourceType: 'dataextension' }
  }
  if (!de && !t.ent) {
    const s = await findSharedDE(stack, t.name).catch(() => null)
    if (s) de = { ...s, sourceType: s.sourceType || 'shared' }
  }
  if (!de) return null
  const data = await fetchDEFieldsCached(stack, de.id).catch(() => null)
  return { id: de.id, name: de.name, sourceType: de.sourceType, fields: data?.fields || [] }
}

/**
 * SQL to builder state: { branches: [state], ops, notes } (one state per SELECT of a
 * UNION / EXCEPT / INTERSECT) or { error }.
 */
export async function importSqlToBuilder(sql, stack) {
  const { branches: parts, ops } = splitSetOperations(sql)
  const branches = []
  const notes = []
  for (let i = 0; i < parts.length; i++) {
    const parsed = parseSqlForBuilder(parts[i])
    if (parsed.error) return { error: parts.length > 1 ? `SELECT ${i + 1}: ${parsed.error}` : parsed.error }
    const m = await builderFromParsed(parsed, (t) => resolveTableForBuilder(stack, t))
    const tag = parts.length > 1 ? `SELECT ${i + 1}: ` : ''
    for (const n of m.notes) if (!notes.includes(n) && !notes.includes(tag + n)) notes.push(tag + n)
    branches.push({ selectedDEs: m.selectedDEs, joins: m.joins, where: m.where, queryOptions: m.queryOptions, layout: {} })
  }
  if (!stack && branches.some((b) => b.selectedDEs.some((d) => d.missing))) notes.unshift('Not connected to SFMC, so data extensions could not be looked up.')
  if (ops.length) notes.unshift(`${ops.length + 1} SELECT statements joined with ${[...new Set(ops)].join(', ')}: each has its own tab.`)
  return { branches, ops, state: branches[0], notes }
}
