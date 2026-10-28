// Save as query activity (feedback #88): the query in Run Query becomes a named
// Query Activity writing to a new or an existing data extension, in folders the user
// picks. It is created only; never run or scheduled.
import {
  createTargetDE, createQueryActivity, listQAFolders, listDERootFolders, listDEChildFolders,
  QUERY_UPDATE_TYPES,
} from './sfmcApi.js'

export const UPDATE_TYPE_OPTIONS = Object.entries(QUERY_UPDATE_TYPES).map(([id, label]) => ({ id: Number(id), label }))

/** Query Activity folders as an indented list, parents before children, by name. */
export function qaFolderOptions(items = []) {
  const byParent = new Map()
  for (const f of items) {
    const p = f.parentId ?? 0
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p).push(f)
  }
  const ids = new Set(items.map((f) => f.categoryId))
  const out = []
  const walk = (parent, depth, path) => {
    for (const f of [...(byParent.get(parent) || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const p = [...path, f.name]
      out.push({ id: f.categoryId, name: f.name, depth, path: p.join(' > ') })
      walk(f.categoryId, depth + 1, p)
    }
  }
  // Roots: parentId 0 or a parent not in the list.
  const roots = items.filter((f) => !f.parentId || !ids.has(f.parentId)).map((f) => f.parentId ?? 0)
  for (const r of [...new Set(roots)]) walk(r, 0, [])
  return out
}

export async function loadQAFolders(stack) {
  return qaFolderOptions((await listQAFolders(stack))?.items || [])
}

/** The local "Data Extensions" root folder (the one new DEs go under). */
export async function loadDERoot(stack) {
  const entry = (await listDERootFolders(stack))?.entry || []
  const root = entry.find((f) => String(f.type).toLowerCase() === 'dataextension') || null
  return root ? { id: root.id, name: root.name || 'Data Extensions' } : null
}

export async function loadDEChildFolders(stack, id) {
  const entry = (await listDEChildFolders(stack, id))?.entry || []
  return entry
    .filter((f) => !f.type || String(f.type).toLowerCase() === 'dataextension')
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** What is missing from the form, or ''. */
export function checkSaveForm(f) {
  if (!String(f.activityName || '').trim()) return 'Enter a name for the query activity.'
  if (f.qaFolderId == null) return 'Pick a folder for the query activity.'
  if (f.targetMode === 'existing') {
    if (!f.existingDE?.id) return 'Pick the data extension the query writes to.'
  } else {
    if (!String(f.deName || '').trim()) return 'Enter a name for the new data extension.'
    if (f.deFolderId == null) return 'Pick a folder for the new data extension.'
  }
  if (!(f.updateType in QUERY_UPDATE_TYPES)) return 'Pick how the query writes its rows.'
  return ''
}

/**
 * Creates the DE (when new) and the Query Activity. `resolveFields(sql)` gives the
 * new DE's fields ({ fields, activitySql }); `cleanSql(sql)` the SQL as Run sends it.
 * Returns { de, activity }.
 */
export async function saveAsQueryActivity(stack, f, { sql, resolveFields, cleanSql, api = { createTargetDE, createQueryActivity } }) {
  const problem = checkSaveForm(f)
  if (problem) throw new Error(problem)
  let de
  let queryText = cleanSql(sql)
  if (f.targetMode === 'existing') {
    de = { id: f.existingDE.id, key: f.existingDE.customerKey || f.existingDE.key || '', name: f.existingDE.name }
  } else {
    const target = await resolveFields(sql)
    if (!target?.fields?.length) throw new Error('Could not work out the columns of the new data extension.')
    if (target.activitySql) queryText = target.activitySql
    const created = await api.createTargetDE(stack, { name: f.deName.trim(), fields: target.fields, categoryID: Number.parseInt(f.deFolderId, 10) })
    de = { id: created.id, key: created.customerKey, name: f.deName.trim(), created: true }
  }
  const act = await api.createQueryActivity(stack, {
    name: f.activityName.trim(),
    description: 'Created by Marketing Cloud Toolkit (Save as query activity).',
    queryText,
    targetName: de.name,
    targetKey: de.key,
    targetId: de.id,
    categoryId: f.qaFolderId,
    updateType: f.updateType,
  })
  return { de, activity: { id: act.queryDefinitionId, key: act.key, name: f.activityName.trim() } }
}
