import { createSharedDECatalog } from './sharedDEs.js'
import { startRequest } from './activityStart.js'

// Base URLs - exacttarget.com/cloud/fuelapi for core APIs (injected from ET tab)
const AS_BASE = (stack) => `https://mc.${stack}.exacttarget.com/cloud/fuelapi`
const CM_BASE = (stack) => `https://mc.${stack}.exacttarget.com/cloud/fuelapi/internal`
const CM_DATA = (stack) => `https://mc.${stack}.exacttarget.com/cloud/fuelapi/data-internal`

// marketingcloudapps.com base URLs - folder/category management APIs
// These must be injected from an MCA tab (see background.js proxy tab selection)
const MCA_AS  = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi`
const MCA_CM  = (stack) => `https://mc.${stack}.marketingcloudapps.com/contactsmeta/fuelapi`

// ── Folder ID cache ───────────────────────────────────────
// Keyed by stack. Entries expire after FOLDER_CACHE_TTL ms or when the page closes.
const FOLDER_CACHE_TTL = 20 * 60 * 1000 // 20 minutes
const _folderCache = {} // { [stack]: { deCategoryId, qaCategoryId, ts } }

function _getCached(stack, key) {
  const entry = _folderCache[stack]
  if (!entry) return null
  if (Date.now() - entry.ts > FOLDER_CACHE_TTL) { delete _folderCache[stack]; return null }
  return entry[key] ?? null
}

function _setCached(stack, key, value) {
  if (!_folderCache[stack]) _folderCache[stack] = { ts: Date.now() }
  _folderCache[stack][key] = value
  _folderCache[stack].ts = Date.now()
}

// ── API console log callback ──────────────────────────────
// Register a function to receive every API request/response for the UI console.
let _logCallback = null
export function setApiLogCallback(fn) { _logCallback = fn }
function _log(entry) { if (_logCallback) try { _logCallback(entry) } catch {} }
function _logInfo(message) { _log({ ts: Date.now(), type: 'info', message }) }
export function logInfo(message) { _logInfo(message) }

// The last few SFMC calls, for the feedback form's technical details. Only the
// method, the path, paging and sort parameters (other query values, which can hold
// names, are left out), the status, the time taken and how many items came back.
const SAFE_PARAMS = new Set(['$page', '$pagesize', '$top', '$skip', '$sort', '$orderby', 'retrievalType', 'view', 'mostRecentVersionOnly', 'extras', 'versionNumber'])
const _recentErrors = []
const _recentCalls = []
export function apiCallPath(url) {
  try {
    const u = new URL(url)
    const params = [...u.searchParams.keys()].map((k) => (SAFE_PARAMS.has(k) || SAFE_PARAMS.has(k.toLowerCase()) ? `${k}=${u.searchParams.get(k)}` : `${k}=…`))
    return u.host + u.pathname + (params.length ? `?${params.join('&')}` : '')
  } catch { return String(url).split('?')[0] }
}
const _itemCount = (d) => {
  const list = d?.items ?? d?.entry ?? (Array.isArray(d) ? d : null)
  return Array.isArray(list) ? list.length : null
}
function _rememberCall(method, url, started, { status = null, data, error } = {}) {
  const call = { at: new Date(started).toISOString(), method, path: apiCallPath(url), status, ms: Date.now() - started }
  if (error) call.error = String(error).slice(0, 300)
  else {
    const n = _itemCount(data)
    if (n != null) call.items = n
    const total = data?.count ?? data?.totalCount ?? data?.totalResults
    if (typeof total === 'number') call.total = total
  }
  _recentCalls.unshift(call)
  _recentCalls.length = Math.min(_recentCalls.length, 20)
  if (error) {
    _recentErrors.unshift({ at: call.at, method, path: call.path, status, error: call.error })
    _recentErrors.length = Math.min(_recentErrors.length, 5)
  }
}
export function recentApiErrors() { return [..._recentErrors] }
export function recentApiCalls() { return [..._recentCalls] }

/**
 * Generic authenticated proxy fetch - exposed for callers that need a raw
 * PUT/POST/GET without a dedicated wrapper (e.g. Content Builder revert).
 */
export function sfmcFetch(url, method, body = null) {
  return proxyFetch(url, method, body)
}

/**
 * Routes ALL requests through the background service worker, which fetches
 * directly (no tab injection) using cookies for exacttarget.com or a minted
 * Bearer token for marketingcloudapps.com (src/background/fetchProxy.js).
 */
// Calls made from this page, so a run can say how many it used (SQL Studio shows this
// for rate-limit-conscious users). Includes calls by other panels running at the same time.
let _callCount = 0
export function sfmcCallCount() { return _callCount }

function proxyFetch(url, method, body) {
  _callCount++
  const ts = Date.now()
  _log({ ts, type: 'req', method, url, body })
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'SFMC_FETCH', url, method, body }, (response) => {
      const error = chrome.runtime.lastError?.message || response?.error ||
        (response ? null : 'No reply from the extension service worker.')
      if (error) {
        _log({ ts: Date.now(), type: 'err', method, url, error })
        _rememberCall(method, url, ts, { status: response?.status ?? null, error })
        const err = new Error(error)
        err.code = response?.code || null
        err.status = response?.status ?? null
        err.app = response?.app || null
        return reject(err)
      }
      _log({ ts: Date.now(), type: 'res', method, url, result: response.data })
      _rememberCall(method, url, ts, { status: response.status ?? 200, data: response.data })
      resolve(response.data)
    })
  })
}

// ── Validate ─────────────────────────────────────────────

/**
 * Searches for a Data Extension by name to confirm existence and get field count.
 * Returns { id, name, fieldCount } on success.
 * Throws if DE is not found or inaccessible.
 */
export async function fetchDEMetadata(stack, deName) {
  _logInfo(`Searching for Data Extension by name: "${deName}" - checking it exists and getting field count`)
  const url = `${CM_DATA(stack)}/v1/customobjects/category/0?retrievalType=1&$page=1&$pagesize=25&$orderBy=modifiedDate%20DESC&name=${encodeURIComponent(deName)}`
  const data = await proxyFetch(url, 'GET', null)
  const items = data?.items || []
  const exact = items.find((i) => i.name.toLowerCase() === deName.toLowerCase())
  if (!exact) {
    // Not in the local Data Extensions tree: try Shared Items and Synchronized.
    // If that lookup fails the error is not "DE not found", so nothing is marked missing.
    const shared = await findSharedDE(stack, deName).catch((err) => {
      if (items.length) return null
      throw err
    })
    if (shared) {
      _logInfo(`DE "${deName}" found in ${shared.sourceType === 'sync' ? 'Synchronized' : 'Shared'} Data Extensions - id: ${shared.id}`)
      return { id: shared.id, name: shared.name, fieldCount: shared.fieldCount ?? 0 }
    }
    if (!items.length) throw new Error(`DE not found: ${deName}`)
  }
  const item = exact ?? items[0]
  _logInfo(`DE "${deName}" found - id: ${item.id}, fields: ${item.fieldCount ?? 0}`)
  return { id: item.id, name: item.name, fieldCount: item.fieldCount ?? 0 }
}

// ── Field builder ─────────────────────────────────────────

/**
 * Fetches field definitions for a Data Extension by its internal ID.
 */
export async function fetchDEFields(stack, deId) {
  _logInfo(`Fetching field definitions for DE id: ${deId} - used to infer column types for target DE`)
  const url = `${CM_BASE(stack)}/v1/customobjects/${deId}/fields/`
  return proxyFetch(url, 'GET', null)
}

const DE_TYPE_MAP = { text: 0, number: 1, date: 2, boolean: 3, email: 4, phone: 5, decimal: 6 }

export function resolveFieldType(t) {
  if (typeof t === 'number') return t
  if (typeof t === 'string') return DE_TYPE_MAP[t.toLowerCase()] ?? 0
  return 0
}

/**
 * Builds the `fields` array for DE creation.
 * Type numbers: 0=Text, 1=Number, 2=Date, 3=Boolean, 4=Email, 5=Phone, 6=Decimal
 *
 * SFMC rejects a `length` property on any field whose type isn't Text or
 * Decimal — e.g. "Length is invalid for field EmailAddress because it does
 * not have a data type of Text" — but *requires* it on Decimal (it's the
 * precision digit-count, same UI field as Text's length). Number, Date,
 * Boolean, Email, and Phone must omit `length` entirely. Decimal precision
 * defaults to 18 and scale to 2 when the source doesn't give valid values.
 */
// Text columns whose length can't be inferred. 4000 is SFMC's Text maximum, so
// query output is never truncated (it used to be 500).
export const DEFAULT_TEXT_LENGTH = 4000

export function buildDEFields(typedColumns) {
  return typedColumns.map((col, i) => {
    const type = resolveFieldType(col.type)
    const field = {
      name: col.name,
      ordinal: i,
      type,
      scale: 0,
      isPrimaryKey: col.isPrimaryKey ?? false,
      isTemplateField: false,
      isHidden: false,
      isReadOnly: false,
      isOverridable: false,
      isInheritable: false,
      updatable: true,
      retrievable: true,
      isActive: true,
      mustOverride: false,
      isNullable: col.isNullable ?? true,
    }
    if (type === 0) field.length = col.length ?? DEFAULT_TEXT_LENGTH
    // EmailAddress goes with length 254, as Contact Builder sends it (user's capture, 2026-10-25).
    if (type === 4) field.length = 254
    if (type === 6) {
      // Decimal length is the precision (1-38). It used to default to Text's 500.
      const precision = Number.isInteger(col.length) && col.length >= 1 && col.length <= 38 ? col.length : 18
      field.length = precision
      field.scale  = Math.min(Number.isInteger(col.scale) ? col.scale : 2, precision)
    }
    return field
  })
}

// ── Folder management: Data Extensions ───────────────────

/**
 * Returns root DE folders (Data Extensions, Shared Items, Recycle Bin, etc.)
 * Response: { entry: [{ id, type, name, parentId, ... }] }
 */
export async function listDERootFolders(stack) {
  const url = `${MCA_CM(stack)}/legacy/v1/beta/folder?$where=allowedtypes%20in%20(%27synchronizeddataextension%27,%20%27dataextension%27,%20%27shared_data%27,%20%27salesforcedataextension%27,%20%27recyclebin%27)`
  return proxyFetch(url, 'GET', null)
}


/**
 * Lists child folders of a given DE folder ID.
 * Response: { entry: [{ id, type, name, parentId, ... }] }
 */
export async function listDEChildFolders(stack, folderId) {
  const url = `${MCA_CM(stack)}/legacy/v1/beta/folder/${folderId}/children?$top=1000&$skip=0`
  return proxyFetch(url, 'GET', null)
}

/**
 * Creates a DE folder/category under a given parent.
 * Response: { categoryId, parentCatId, name, catType, objectId }
 */
async function createDEFolder(stack, name, parentCatId) {
  const url = `${MCA_CM(stack)}/email/v1/category/`
  return proxyFetch(url, 'POST', { parentCatId, name, catType: 'dataextension' })
}

/**
 * Resolves (or creates) the 'QuerySaver' folder under 'Data Extensions'.
 * Returns the numeric categoryId to use when creating target DEs.
 *
 * Step 1: list root DE folders → find 'Data Extensions' → get its ID
 * Step 2: list children of that folder → look for 'QuerySaver', then 'QueryStudioResults'
 * Step 3: neither found → try to create 'QuerySaver'
 * Step 4: creation fails → fall back to the 'Data Extensions' folder ID itself
 */
export async function getOrCreateDEFolder(stack) {
  const cached = _getCached(stack, 'deCategoryId')
  if (cached != null) {
    console.log('[SFMCQS:folders] DE folder ID from cache:', cached)
    return cached
  }

  // Step 1: get root DE folders and find 'Data Extensions'
  _logInfo('Fetching root DE folder list…')
  console.log('[SFMCQS:folders] listing root DE folders')
  const rootData = await listDERootFolders(stack)
  console.log('[SFMCQS:folders] root DE folders:', rootData)
  const rootDE = (rootData.entry || []).find(
    (f) => f.name === 'Data Extensions' && f.type === 'dataextension'
  )
  if (!rootDE) throw new Error('Could not find "Data Extensions" root folder')
  const rootId = parseInt(rootDE.id, 10)
  _logInfo(`Found "Data Extensions" folder - id: ${rootId}`)
  console.log('[SFMCQS:folders] Data Extensions folder ID:', rootId)

  // Step 2: list child folders and look for 'QuerySaver', fall back to 'QueryStudioResults'
  _logInfo(`Fetching child folders of "Data Extensions" (id: ${rootId})…`)
  console.log('[SFMCQS:folders] listing children of folder', rootId)
  const childData = await listDEChildFolders(stack, rootId)
  console.log('[SFMCQS:folders] child folders:', childData)
  const children = childData.entry || []
  _logInfo(`Child folders loaded - ${children.length} folder(s) found`)

  const querySaver = children.find((f) => f.name?.toLowerCase() === 'querysaver')
  if (querySaver) {
    const id = parseInt(querySaver.id, 10)
    _logInfo(`Search "QuerySaver" folder: Found (id: ${id})`)
    console.log('[SFMCQS:folders] found QuerySaver folder:', id)
    _setCached(stack, 'deCategoryId', id)
    return id
  }
  _logInfo('Search "QuerySaver" folder: Not found')

  const queryStudio = children.find((f) => f.name?.toLowerCase() === 'querystudioresults')
  if (queryStudio) {
    const id = parseInt(queryStudio.id, 10)
    _logInfo(`Search "QueryStudioResults" folder: Found - using as fallback (id: ${id})`)
    console.log('[SFMCQS:folders] found QueryStudioResults folder, using as fallback:', id)
    _setCached(stack, 'deCategoryId', id)
    return id
  }
  _logInfo('Search "QueryStudioResults" folder: Not found')

  // Step 3: neither found - try to create 'QuerySaver'
  _logInfo(`No suitable folder found - creating "QuerySaver" under "Data Extensions" (id: ${rootId})…`)
  console.log('[SFMCQS:folders] no suitable folder found - creating QuerySaver under', rootId)
  try {
    const created = await createDEFolder(stack, 'QuerySaver', rootId)
    console.log('[SFMCQS:folders] created QuerySaver folder:', created)
    _logInfo(`"QuerySaver" folder created (id: ${created.categoryId})`)
    _setCached(stack, 'deCategoryId', created.categoryId)
    return created.categoryId
  } catch (err) {
    // Step 4: creation failed - use 'Data Extensions' folder directly
    _logInfo(`Folder creation failed: ${err.message} - falling back to "Data Extensions" folder (id: ${rootId})`)
    console.warn('[SFMCQS:folders] folder creation failed, using root Data Extensions folder:', err.message)
    _setCached(stack, 'deCategoryId', rootId)
    return rootId
  }
}

// ── Folder management: Query Activities ──────────────────

/**
 * Returns all Query Activity folders.
 * Response: { items: [{ categoryId, parentId, name, categoryType }] }
 */
export async function listQAFolders(stack) {
  _logInfo('Fetching all Query Activity folders - looking for "QuerySaver" folder to place the new activity')
  const url = `${MCA_AS(stack)}/automation/v1/folders/?$filter=categorytype%20eq%20queryactivity`
  return proxyFetch(url, 'GET', null)
}

/**
 * Creates a Query Activity folder under the given parent.
 * Response: { id, parentId, name, categoryType, ... }
 */
async function createQAFolder(stack, name, parentId) {
  _logInfo(`Creating Query Activity folder "${name}" under parent id: ${parentId}`)
  const url = `${MCA_AS(stack)}/platform-internal/v1/categories/`
  return proxyFetch(url, 'POST', { name, parentId, categoryType: 'queryactivity', editable: 1, extendable: 1 })
}

/**
 * Resolves (or creates) the 'QuerySaver' folder under the root 'Query' folder.
 * Returns the numeric categoryId to use when creating Query Activities.
 */
export async function getOrCreateQAFolder(stack) {
  const cached = _getCached(stack, 'qaCategoryId')
  if (cached != null) {
    console.log('[SFMCQS:folders] QA folder ID from cache:', cached)
    return cached
  }

  console.log('[SFMCQS:folders] getOrCreateQAFolder - listing QA folders')
  const data = await listQAFolders(stack)
  console.log('[SFMCQS:folders] QA folders response:', data)
  const items = data.items || []

  // Check if 'QuerySaver' already exists
  const existing = items.find((f) => f.name === 'QuerySaver')
  if (existing) {
    _logInfo(`Search "QuerySaver" QA folder: Found (id: ${existing.categoryId})`)
    console.log('[SFMCQS:folders] found existing QuerySaver QA folder:', existing)
    _setCached(stack, 'qaCategoryId', existing.categoryId)
    return existing.categoryId
  }
  _logInfo('Search "QuerySaver" QA folder: Not found - will create it')

  // Find the root 'Query' folder (parentId === 0)
  const root = items.find((f) => f.name === 'Query' && f.parentId === 0)
  const parentId = root?.categoryId ?? 0
  console.log('[SFMCQS:folders] creating QuerySaver QA folder under parentId', parentId)

  // Create 'QuerySaver' under root
  try {
    const created = await createQAFolder(stack, 'QuerySaver', parentId)
    console.log('[SFMCQS:folders] created QA folder:', created)
    _logInfo(`"QuerySaver" QA folder created (id: ${created.id})`)
    _setCached(stack, 'qaCategoryId', created.id)
    return created.id
  } catch (err) {
    // Already exists - find it again
    if (err.message && (err.message.includes('exist') || err.message.includes('duplicate') || err.message.includes('400'))) {
      _logInfo('QA folder creation returned duplicate - re-fetching to get existing id')
      const retryData = await listQAFolders(stack)
      const found = (retryData.items || []).find((f) => f.name === 'QuerySaver')
      if (found) {
        _logInfo(`"QuerySaver" QA folder found on retry (id: ${found.categoryId})`)
        _setCached(stack, 'qaCategoryId', found.categoryId)
        return found.categoryId
      }
    }
    throw err
  }
}

// ── Run step 1: Create target Data Extension ─────────────

/**
 * Creates a target Data Extension to receive query results.
 *
 * With `retentionDays`, rows older than that are deleted by SFMC (row-based retention).
 * If SFMC refuses the retention properties, the DE is created without them.
 *
 * @param {string} stack
 * @param {{ name: string, fields: object[], categoryID: number, retentionDays?: number }} payload
 * @returns {Promise<{ id: string, customerKey: string, name: string }>}
 */
export async function createTargetDE(stack, payload) {
  _logInfo(`Creating target Data Extension "${payload.name}" with ${payload.fields.length} field(s) in folder id: ${payload.categoryID} - this DE will receive query results`)
  const url = `${CM_BASE(stack)}/v1/customobjects/`
  const body = {
    importActivity: {},
    name: payload.name,
    categoryID: payload.categoryID,
    isActive: true,
    status: 0,
    isObjectDeletable: true,
    isFieldAdditionAllowed: true,
    isFieldModificationAllowed: true,
    isTestable: false,
    isSendable: false,
    fields: payload.fields,
  }
  const days = payload.retentionDays
  if (!(days > 0)) return proxyFetch(url, 'POST', body)
  try {
    return await proxyFetch(url, 'POST', { ...body, dataRetentionProperties: retentionProperties(days) })
  } catch (err) {
    if (!/retention/i.test(err.message)) throw err
    _logInfo(`SFMC refused the ${days}-day data retention (${err.message}); creating the Data Extension without it`)
    return proxyFetch(url, 'POST', body)
  }
}

// Days a row stays in Run Query's new target DEs (feedback #27). Off (0) unless
// switched on in Settings; 7 is offered when it is.
export const DEFAULT_RETENTION_DAYS = 0
export const SUGGESTED_RETENTION_DAYS = 7
export function parseRetentionDays(v) {
  return Number.isInteger(v) && v >= 0 && v <= 3650 ? v : DEFAULT_RETENTION_DAYS
}

/** Row-based retention: each row is deleted `days` days after it was added. */
export function retentionProperties(days) {
  return {
    isRowBasedRetention: true,
    isDeleteAtEndOfRetentionPeriod: false,
    isResetRetentionPeriodOnImport: false,
    dataRetentionPeriodLength: days,
    dataRetentionPeriodUnitOfMeasure: 3, // days
  }
}

// ── Run step 2: Create Query Activity ────────────────────

/**
 * Creates a Query Activity in Automation Studio.
 *
 * @param {string} stack
 * @param {{ name: string, queryText: string, targetName: string, targetKey: string, targetId: string, categoryId: number }} payload
 * @returns {Promise<{ queryDefinitionId: string, key: string, name: string }>}
 */
// Query Activity update types (targetUpdateTypeId); Import activities number theirs differently.
export const QUERY_UPDATE_TYPES = { 0: 'Overwrite', 1: 'Update', 2: 'Append' }

export async function createQueryActivity(stack, payload) {
  _logInfo(`Creating Query Activity "${payload.name}" - wraps the SQL query and points to target DE "${payload.targetName}"`)
  const url = `${AS_BASE(stack)}/automation/v1/queries`
  const updateType = QUERY_UPDATE_TYPES[payload.updateType] ? payload.updateType : 0
  const body = {
    name: payload.name,
    ...(payload.key ? { key: payload.key } : {}),
    description: payload.description ?? 'Auto-created by SFMC Query Saver',
    queryText: payload.queryText,
    targetName: payload.targetName,
    targetKey: payload.targetKey,
    targetId: payload.targetId,
    targetUpdateTypeId: String(updateType),
    targetUpdateTypeName: QUERY_UPDATE_TYPES[updateType],
    validatedQueryText: '',
    isFrozen: false,
    ...(payload.categoryId != null ? { categoryId: payload.categoryId } : {}),
  }
  return proxyFetch(url, 'POST', body)
}

/**
 * Creates an automation with no schedule (Automation Templates). steps: [{ name,
 * activities: [{ name, id }] }], each activity a Query Activity. Not checked live.
 */
/**
 * `categoryId` puts it in an Automation Studio folder; `notifyEmail` asks for emails on
 * completion and on errors (feedback #152; the notifications shape is not confirmed:
 * when SFMC refuses it, the automation is created without them and
 * `notificationsFailed` is set).
 */
export async function createAutomation(stack, { name, key, description, steps, categoryId, notifyEmail }) {
  _logInfo(`Creating automation "${name}" with ${steps.length} step(s), not scheduled`)
  const url = `${AS_BASE(stack)}/automation/v1/automations`
  const body = {
    name,
    ...(key ? { key } : {}),
    description: description || '',
    ...(categoryId ? { categoryId: Number(categoryId) } : {}),
    steps: steps.map((s, i) => ({
      name: s.name,
      step: i + 1,
      activities: s.activities.map((a, j) => ({ name: a.name, objectTypeId: 300, activityObjectId: a.id, displayOrder: j + 1 })),
    })),
  }
  const email = String(notifyEmail || '').trim()
  if (!email) return proxyFetch(url, 'POST', body)
  const notifications = ['Complete', 'Error'].map((notificationType) => ({ email: [email], message: '', channelType: 'Account', notificationType }))
  try {
    return await proxyFetch(url, 'POST', { ...body, notifications })
  } catch (err) {
    if (!/notif/i.test(err.message)) throw err
    _logInfo(`SFMC refused the email notifications (${err.message}); creating the automation without them`)
    const r = await proxyFetch(url, 'POST', body)
    return { ...r, notificationsFailed: true }
  }
}

/** Automation Studio's automation folders ({ items }), as for Query Activity folders. Not checked live. */
export async function listAutomationFolders(stack) {
  return proxyFetch(`${MCA_AS(stack)}/automation/v1/folders/?$filter=categorytype%20eq%20automations`, 'GET', null)
}

/**
 * A data extension for Automation Templates: given customer key, optionally
 * sendable (send relationship `sendableField` -> Subscriber Key). If SFMC refuses
 * the sendable settings, the DE is created without them and `sendableFailed` is set.
 */
export async function createTemplateDE(stack, { name, key, fields, categoryID, sendableField }) {
  _logInfo(`Creating data extension "${name}" (${fields.length} fields${sendableField ? ', sendable' : ''})`)
  const url = `${CM_BASE(stack)}/v1/customobjects/`
  const body = {
    importActivity: {}, name, customerKey: key, categoryID, isActive: true, status: 0,
    isObjectDeletable: true, isFieldAdditionAllowed: true, isFieldModificationAllowed: true,
    isTestable: false, isSendable: false, fields,
  }
  if (!sendableField) return proxyFetch(url, 'POST', body)
  try {
    return await proxyFetch(url, 'POST', { ...body, isSendable: true, sendableCustomObjectField: sendableField, sendableSubscriberField: '_SubscriberKey' })
  } catch (err) {
    if (!/sendable|subscriber/i.test(err.message)) throw err
    _logInfo(`SFMC refused the sendable settings (${err.message}); creating "${name}" without them`)
    return { ...(await proxyFetch(url, 'POST', body)), sendableFailed: true }
  }
}

/**
 * Create DE (feedback #94): posts a complete data extension body (fields, folder,
 * sendable, retention) as built by utils/createDE/createDE.js. Unlike
 * createTargetDE and createTemplateDE it never drops settings SFMC refuses: the
 * error goes back to the user.
 */
export async function createDataExtension(stack, body) {
  _logInfo(`Creating data extension "${body.name}" (${body.fields.length} fields, types as ${typeof body.fields[0]?.type === 'number' ? 'numbers' : 'names'}${body.isSendable ? ', sendable' : ''}${body.dataRetentionProperties ? ', with data retention' : ''})`)
  return proxyFetch(`${CM_BASE(stack)}/v1/customobjects/`, 'POST', body)
}

/**
 * Adds rows to a data extension by key with SFMC's async insert (no primary key
 * needed). SFMC answers with a request id and adds the rows in the background.
 * Not checked live.
 */
export async function insertDERowsAsync(stack, key, items) {
  _logInfo(`Adding ${items.length} row(s) to data extension "${key}"`)
  return proxyFetch(`${AS_BASE(stack)}/data/v1/async/dataextensions/key:${encodeURIComponent(key)}/rows`, 'POST', { items })
}

/** Adds or updates rows by primary key (async upsert: PUT on the same endpoint). */
export async function upsertDERowsAsync(stack, key, items) {
  _logInfo(`Adding or updating ${items.length} row(s) in data extension "${key}"`)
  return proxyFetch(`${AS_BASE(stack)}/data/v1/async/dataextensions/key:${encodeURIComponent(key)}/rows`, 'PUT', { items })
}

export async function deleteAutomation(stack, id) {
  _logInfo(`Deleting automation (id: ${id})`)
  await proxyFetch(`${AS_BASE(stack)}/automation/v1/automations/${encodeURIComponent(id)}`, 'DELETE', null)
}

/** ID of the root "Data Extensions" folder. */
export async function getDERootFolderId(stack) {
  const rootDE = ((await listDERootFolders(stack)).entry || []).find((f) => f.name === 'Data Extensions' && f.type === 'dataextension')
  if (!rootDE) throw new Error('Could not find the "Data Extensions" folder.')
  return parseInt(rootDE.id, 10)
}

/** ID of the root "Query" folder in Automation Studio, or null. */
export async function getQueryRootFolderId(stack) {
  const root = ((await listQAFolders(stack)).items || []).find((f) => f.name === 'Query' && f.parentId === 0)
  return root?.categoryId ?? null
}

// ── Run step 3a: Start Query Activity ────────────────────

export async function startQueryActivity(stack, queryDefinitionId) {
  _logInfo(`Starting Query Activity (id: ${queryDefinitionId}) - SFMC will now execute the SQL and populate the target DE`)
  const url = `${AS_BASE(stack)}/automation/v1/queries/${queryDefinitionId}/actions/start/`
  await proxyFetch(url, 'POST', {})
}

/** Run once for a data extract, import, file transfer or script (utils/activityStart.js). */
export async function startActivity(stack, typeId, id) {
  const { url, body } = startRequest(stack, typeId, id)
  _logInfo(`Starting activity (type ${typeId}, id: ${id}) in SFMC`)
  return proxyFetch(url, 'POST', body)
}

// ── Run step 3b: Poll status ──────────────────────────────

export async function getQueryActivityStatus(stack, queryDefinitionId) {
  _logInfo(`Polling query run status (id: ${queryDefinitionId}) - checking if SFMC has finished executing`)
  const url = `${AS_BASE(stack)}/automation/v1/queries/${queryDefinitionId}/actions/isrunning/`
  return proxyFetch(url, 'GET', null)
}

// ── Run step 4: Fetch results ─────────────────────────────

export async function fetchDERows(stack, deKey, page = 1, pageSize = 2500) {
  _logInfo(`Fetching result rows from DE "${deKey}" - page ${page}, up to ${pageSize} rows`)
  const url = `${AS_BASE(stack)}/data/v1/customobjectdata/key/${encodeURIComponent(deKey)}/rowset?$page=${page}&$pagesize=${pageSize}`
  return proxyFetch(url, 'GET', null)
}

// ── Cleanup: Delete DE ────────────────────────────────────

export async function deleteDE(stack, deId) {
  _logInfo(`Deleting temporary target Data Extension (id: ${deId}) - cleanup after query run`)
  const url = `${CM_BASE(stack)}/v1/customobjects/${deId}`
  await proxyFetch(url, 'DELETE', null)
}

/// ── Validate query text ───────────────────────────────────

/**
 * Lists Query Activities ordered by most recently modified.
 * Returns up to pageSize items with full detail (name, queryText, modifiedDate).
 */
export async function listQueryActivities(stack, pageSize = 200) {
  _logInfo(`Fetching Query Activities (up to ${pageSize}, ordered by modified date)…`)
  const url = `${MCA_AS(stack)}/automation/v1/queries/?$page=1&$pageSize=${pageSize}&$orderBy=modifiedDate%20desc&retrievalType=1`
  return proxyFetch(url, 'GET', null)
}

/**
 * Returns the queryDefinitionId of any existing Query Activity in the BU.
 * Used as a proxy to call the validate endpoint.
 * Throws if no activities exist.
 */
export async function getAnyQueryActivityId(stack) {
  _logInfo('Fetching any existing Query Activity - needed as a proxy to call the SFMC SQL validation endpoint')
  // Fetch recent activities and prefer a non-SFMCQS one.
  // SFMCQS_Act activities reference deleted target DEs - SFMC validates
  // the stored queryText of the proxy activity, so stale SFMCQS activities
  // produce false "DE not found" errors.
  const url = `${MCA_AS(stack)}/automation/v1/queries/?$page=1&$pageSize=25&$orderBy=modifiedDate%20desc&retrievalType=1`
  const data = await proxyFetch(url, 'GET', null)
  const items = data.items || []
  if (!items.length) throw new Error('NO_ACTIVITIES')
  const preferred = items.find(i => !i.name?.startsWith('SFMCQS_')) ?? items[0]
  return preferred.queryDefinitionId
}

/**
 * Validates a SQL query string using SFMC's own validation engine.
 * Requires an existing queryDefinitionId as a proxy entry point.
 * Response: { queryValid, errors: [{ message }], warnings: [{ message }] }
 */
export async function validateQueryText(stack, queryDefinitionId, sql) {
  _logInfo(`Validating SQL query text using proxy activity id: ${queryDefinitionId} - checking for syntax errors`)
  const url = `${MCA_AS(stack)}/automation/v1/queries/${queryDefinitionId}/actions/validate/`
  return proxyFetch(url, 'POST', { text: sql })
}

// ── Cleanup: Delete Query Activity ───────────────────────

export async function deleteQueryActivity(stack, queryDefinitionId) {
  _logInfo(`Deleting temporary Query Activity (id: ${queryDefinitionId}) - cleanup after query run`)
  const url = `${AS_BASE(stack)}/automation/v1/queries/${queryDefinitionId}`
  await proxyFetch(url, 'DELETE', null)
}

// ── Find DE ───────────────────────────────────────────────

/**
 * Fetches all Data Extensions in a given category/folder.
 * Response: { items: [{ id, name, fieldCount, categoryId, ... }] }
 */
export async function fetchDEsInCategory(stack, categoryId, page = 1, pageSize = 200) {
  const url = `${CM_DATA(stack)}/v1/customobjects/category/${categoryId}?retrievalType=1&$page=${page}&$pagesize=${pageSize}`
  return proxyFetch(url, 'GET', null)
}

/**
 * Fetches all DEs in a category, paginating until exhausted.
 */
export async function fetchDEsInCategoryAllPages(stack, categoryId, pageSize = 200) {
  const all = []
  let page = 1
  let total = Infinity
  while (all.length < total) {
    const data = await fetchDEsInCategory(stack, categoryId, page, pageSize)
    const items = data?.items || []
    total = data?.count ?? items.length
    all.push(...items)
    if (!items.length || items.length < pageSize) break
    page++
  }
  return all
}

/**
 * Global DE search with wildcard (category/0).
 */
export async function searchDEsGlobal(stack, name, page = 1, pageSize = 25) {
  const q = encodeURIComponent(`%${name.trim()}%`)
  const url = `${CM_DATA(stack)}/v1/customobjects/category/0?retrievalType=1&$page=${page}&$pagesize=${pageSize}&$orderBy=modifiedDate%20DESC&name=${q}`
  return proxyFetch(url, 'GET', null)
}

/**
 * Local DEs whose name contains `name` (case-insensitive, taken literally). The core
 * `name=%text%` search came back empty on s10 for "Master_Subscribers" (feedback
 * #89), so when it finds nothing, fails or is ignored (returns names without the
 * text), Contact Builder's host is asked the same, then with `$search` (matches from
 * the start of a word, as the Data Extensions page does). Results are matched here.
 */
export async function searchLocalDEsByName(stack, name, pageSize = 25) {
  const term = String(name || '').trim()
  if (!term) return { items: [] }
  const has = (d) => String(d?.name || '').toLowerCase().includes(term.toLowerCase())
  const query = `retrievalType=1&$page=1&$pagesize=${pageSize}&$orderBy=modifiedDate%20DESC`
  const meta = `https://mc.${stack}.marketingcloudapps.com/contactsmeta/fuelapi/data-internal/v1/customobjects/category/0?${query}`
  const like = `&name=${encodeURIComponent(`%${term}%`)}`
  const attempts = [
    `${CM_DATA(stack)}/v1/customobjects/category/0?${query}${like}`,
    meta + like,
    `${meta}&$search=${encodeURIComponent(term)}`,
  ]
  let lastError = null
  let answered = false
  for (const url of attempts) {
    try {
      const data = await proxyFetch(url, 'GET', null)
      answered = true
      const items = (data?.items || []).filter(has)
      if (items.length) return { ...data, items }
    } catch (e) {
      lastError = e
    }
  }
  if (!answered && lastError) throw lastError
  return { items: [] }
}

// ── Shared and Synchronized DEs ──────────────────────────
// searchDEsGlobal (category/0) only covers the local Data Extensions tree.
const _sharedDEs = createSharedDECatalog({
  listRoots: (stack) => listDERootFolders(stack),
  listChildren: (stack, id) => listDEChildFolders(stack, id),
  listDEs: (stack, id) => fetchDEsInCategoryAllPages(stack, id),
})

/** Forgets the Shared and Synchronized DE list (all stacks, or one), so the next search walks the folders again. */
export function clearSharedDECache(stack) {
  _sharedDEs.clear(stack)
}

/** Shared and Synchronized DEs whose name contains `name`, each with sourceType 'shared' or 'sync'. */
export function searchSharedDEs(stack, name) {
  return _sharedDEs.search(stack, name)
}

/** The Shared or Synchronized DE named exactly `name`, or null. */
export function findSharedDE(stack, name) {
  return _sharedDEs.find(stack, name)
}

/**
 * searchDEsGlobal plus Shared and Synchronized DEs: { items }, shared and sync
 * matches first (tagged with sourceType), no duplicates. If the shared lookup
 * fails, only the local results come back.
 */
export async function searchDEsAllSources(stack, name, pageSize = 25) {
  const [local, shared] = await Promise.all([
    searchLocalDEsByName(stack, name, pageSize),
    searchSharedDEs(stack, name).catch(() => []),
  ])
  const sharedIds = new Set(shared.map(de => de.id))
  const items = [...shared, ...(local?.items || []).filter(de => !sharedIds.has(de.id))]
  return { ...local, items }
}

const _fieldCache = {}
const FIELD_CACHE_TTL = 10 * 60 * 1000

export async function fetchDEFieldsCached(stack, deId) {
  const key = `${stack}:${deId}`
  const hit = _fieldCache[key]
  if (hit && Date.now() - hit.ts < FIELD_CACHE_TTL) return hit.data
  const data = await fetchDEFields(stack, deId)
  _fieldCache[key] = { data, ts: Date.now() }
  return data
}

/**
 * Recursively searches all DE folders for a Data Extension by name.
 * Returns an array of matches, each with { path: string[], de: object }.
 * `path` is the breadcrumb from root folder down to (but not including) the DE name.
 *
 * @param {string} stack
 * @param {string} deName  - exact name to search for (case-insensitive)
 * @param {(msg: string) => void} [onProgress] - called with the current folder path being searched
 */
export async function findDELocation(stack, deName, onProgress) {
  const rootData = await listDERootFolders(stack)
  const rootFolders = rootData.entry || []
  const results = []
  const searchName = deName.trim().toLowerCase()

  async function searchFolder(folder, pathSoFar) {
    const currentPath = [...pathSoFar, folder.name]
    if (onProgress) onProgress(currentPath.join(' > '))

    const [deResult, childResult] = await Promise.allSettled([
      fetchDEsInCategory(stack, folder.id),
      listDEChildFolders(stack, folder.id),
    ])

    if (deResult.status === 'fulfilled') {
      const des = deResult.value?.items || []
      for (const de of des) {
        if (de.name.trim().toLowerCase() === searchName) {
          results.push({ path: currentPath, de })
        }
      }
    }

    if (childResult.status === 'fulfilled') {
      const children = childResult.value?.entry || []
      await Promise.all(children.map((child) => searchFolder(child, currentPath)))
    }
  }

  await Promise.all(rootFolders.map((folder) => searchFolder(folder, [])))
  return results
}

// ── Business Unit ─────────────────────────────────────────

/**
 * Fetches the current Business Unit details from SFMC.
 * Returns { accountId, name, privateLabelId, accountType, isDemoAccount, parentId }
 */
export async function fetchCurrentBU(stack) {
  _logInfo('Fetching current Business Unit details…')
  const url = `https://mc.${stack}.exacttarget.com/cloud/fuelapi/platform-internal/v1/accounts/@current`
  const d = await proxyFetch(url, 'GET', null)
  // { name, accountId } for the BU badge; the raw response has more fields.
  return d?.name ? { name: d.name, accountId: d.accountId ?? d.id ?? d.memberId ?? null } : null
}

/**
 * The current BU plus whether it is a child BU (feedback #125: DE storage works only
 * from the parent). Which fields accounts/@current carries for the parent is not
 * confirmed, so several likely ones are read; `isChild` is null when unknown.
 */
export async function fetchCurrentBUDetails(stack) {
  const url = `https://mc.${stack}.exacttarget.com/cloud/fuelapi/platform-internal/v1/accounts/@current`
  const d = await proxyFetch(url, 'GET', null)
  if (!d || typeof d !== 'object') return null
  const accountId = d.accountId ?? d.id ?? d.memberId ?? null
  const parentId = d.parentId ?? d.parentAccountId ?? d.parentMid ?? d.parentMID ?? null
  const enterpriseId = d.enterpriseId ?? d.enterpriseAccountId ?? d.eid ?? null
  let isChild = null
  if (parentId != null && Number(parentId) > 0) isChild = String(parentId) !== String(accountId)
  else if (enterpriseId != null && accountId != null) isChild = String(enterpriseId) !== String(accountId)
  else if (typeof d.accountType === 'string' && /enterprise/i.test(d.accountType)) isChild = false
  return { name: d.name || '', accountId, parentId, enterpriseId, isChild }
}
