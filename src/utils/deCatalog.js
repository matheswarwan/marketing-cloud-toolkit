import {
  listDERootFolders, listDEChildFolders,
  fetchDEsInCategoryAllPages, searchDEsAllSources,
} from './sfmcApi.js'
import { DATA_VIEWS, DATA_VIEW_FIELDS } from './dataViews.js'
import { withReconnect, isConnectionError, searchError } from './sfmcErrors.js'

/** Map SFMC root folder type to DE source label */
export const ROOT_TYPE_LABELS = {
  dataextension: 'folder',
  shared_data: 'shared',
  synchronizeddataextension: 'sync',
  salesforcedataextension: 'salesforce',
  recyclebin: 'recycle',
}

export function normalizeDENode(de, sourceType, path = []) {
  return {
    id: de.id,
    name: de.name,
    type: 'de',
    sourceType,
    fieldCount: de.fieldCount ?? null,
    categoryId: de.categoryId,
    path,
  }
}

export function normalizeFolderNode(folder, sourceType, path = []) {
  return {
    id: folder.id,
    name: folder.name,
    type: 'folder',
    sourceType,
    path: [...path, folder.name],
    loaded: false,
    children: [],
  }
}

export function getDataViewNodes() {
  return [...DATA_VIEWS].sort().map((name) => ({
    id: `dv:${name}`,
    name,
    type: 'de',
    sourceType: 'dataview',
    fieldCount: (DATA_VIEW_FIELDS[name.toUpperCase()] || []).length,
    isDataView: true,
  }))
}

/**
 * Load root sections for DE browser (excludes recycle bin by default).
 */
export async function loadRootSections(stack, { includeRecycleBin = false } = {}) {
  const data = await listDERootFolders(stack)
  const roots = (data.entry || []).filter((f) => includeRecycleBin || f.type !== 'recyclebin')
  return roots.map((f) => ({
    ...normalizeFolderNode(f, ROOT_TYPE_LABELS[f.type] || f.type, []),
    rootType: f.type,
  }))
}

/**
 * Lazy-load folder children + DEs for tree expand.
 */
export async function loadFolderContents(stack, folderNode) {
  const folderId = folderNode.id
  const [childFolders, des] = await Promise.all([
    listDEChildFolders(stack, folderId).then((r) => r.entry || []).catch(() => []),
    fetchDEsInCategoryAllPages(stack, folderId).catch(() => []),
  ])
  const subfolders = childFolders.map((f) =>
    normalizeFolderNode(f, folderNode.sourceType, folderNode.path)
  )
  const extensions = des.map((de) =>
    normalizeDENode(de, folderNode.sourceType, [...folderNode.path, folderNode.name])
  )
  return [...subfolders, ...extensions]
}

let _searchTimer = null

/**
 * Debounced global DE search.
 */
export function debouncedSearchDEs(stack, query, onResults, delayMs = 300) {
  clearTimeout(_searchTimer)
  if (!query.trim()) {
    onResults([])
    return
  }
  _searchTimer = setTimeout(async () => {
    try {
      const data = await withReconnect(stack, () => searchDEsAllSources(stack, query.trim()))
      const items = (data?.items || []).map((de) =>
        normalizeDENode(de, de.sourceType || 'search', ['Search results'])
      )
      onResults(items)
    } catch (e) {
      onResults([], isConnectionError(e) ? searchError(e, 'search').message : (e?.message || 'Search failed.'))
    }
  }, delayMs)
}

export function formatDEForSql(name, sourceType) {
  // System data views are referenced bare (e.g. _Open, _Sent).
  if (sourceType === 'dataview' || name.startsWith('_')) return name
  // Preserve ENT. prefix for shared DEs, bracket the remainder.
  const ent = name.match(/^ent\.(.+)$/i)
  if (ent) return `ENT.[${ent[1]}]`
  // Shared DEs are read as ENT.[name] (feedback #73).
  if (sourceType === 'shared') return `ENT.[${name}]`
  return `[${name}]`
}
