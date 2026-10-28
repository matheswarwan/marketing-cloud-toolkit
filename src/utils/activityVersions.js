// Version history of SQL Query and Script activities saved in Automation Studio
// (feedback #122), the way Saved Emails keeps Content Builder emails.
//
// The service worker (background/activityCapture.js) sees Automation Studio's save
// requests, reads the activity as it was just before the save, and stores both.
// Records live in chrome.storage.local:
//   activity_query_<queryDefinitionId>  /  activity_script_<ssjsActivityId>
//   { id, kind, activityId, name, key, stack, businessUnit, timeStamp, versions: [newest first] }
// A version: { versionId, savedAt, source: 'before-save' | 'saved', name, content,
//   targetName, targetKey, targetUpdateType (queries), stack }
//
// Pure helpers only; nothing here calls chrome or SFMC.

export const ACTIVITY_SAVER_SETTING = '_activitySaverEnabled'
export const ACTIVITY_MAX_SETTING = '_activityMaxVersions'
export const DEFAULT_MAX_VERSIONS = 50

const KINDS = {
  query: { segment: 'queries', contentField: 'queryText', idField: 'queryDefinitionId', label: 'SQL Query' },
  script: { segment: 'scripts', contentField: 'script', idField: 'ssjsActivityId', label: 'Script' },
}

export const activityKindLabel = (kind) => KINDS[kind]?.label || 'Activity'
export const recordKey = (kind, id) => `activity_${kind}_${String(id).toLowerCase()}`
export const isActivityKey = (key) => /^activity_(query|script)_/.test(key || '')
/** A stored record key whose id is not an activity id (feedback #130), to be removed. */
export const isBadActivityKey = (key) => isActivityKey(key) && !looksLikeActivityId(String(key).replace(/^activity_(query|script)_/, ''))

const ID = '[0-9a-zA-Z-]{6,}'
// Path words that follow /scripts/ or /queries/ but are not ids (feedback #130: POST
// .../scripts/validate was stored as a script named "validate").
const VERBS = new Set(['validate', 'validation', 'run', 'start', 'stop', 'pause', 'perform', 'actions', 'action', 'search',
  'copy', 'preview', 'test', 'execute', 'status', 'create', 'update', 'delete', 'list', 'query', 'queries', 'script', 'scripts'])
/** Whether a path segment looks like an activity id: a GUID, or has a digit and is not a known verb. */
export function looksLikeActivityId(id) {
  const s = String(id || '')
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true
  return s.length >= 6 && /\d/.test(s) && /^[0-9a-zA-Z-]+$/.test(s) && !VERBS.has(s.toLowerCase())
}
// Automation Studio calls its REST API under AutomationStudioFuel3/fuelapi. The exact
// paths its editor saves to are not confirmed (feedback #129: a script save was not
// caught), so any query or script segment followed by an id under AutomationStudioFuel3
// counts, on marketingcloudapps.com or exacttarget.com hosts, as long as the method
// writes. The diagnostic log below records what Automation Studio really sends.
const QUERY_SEGMENTS = ['queries', 'query', 'queryactivities', 'querydefinitions', 'querydefinition']
const SCRIPT_SEGMENTS = ['scripts', 'script', 'ssjs', 'ssjsactivities', 'ssjsactivity', 'scriptactivities']
const SAVE_RE = new RegExp(`^https://[^/]+\\.([^./]+)\\.(?:marketingcloudapps|exacttarget)\\.com/(?:[^?#]*/)?AutomationStudioFuel3/(?:[^?#]*/)?(${[...QUERY_SEGMENTS, ...SCRIPT_SEGMENTS].join('|')})/(${ID})/?(?:[?#].*)?$`, 'i')
const WRITE_METHODS = new Set(['PATCH', 'PUT', 'POST'])

/** { kind, id, stack } for an Automation Studio save of a query or script, else null. */
export function matchActivitySave(url, method) {
  if (!WRITE_METHODS.has(String(method || '').toUpperCase())) return null
  const m = String(url || '').match(SAVE_RE)
  if (!m || !looksLikeActivityId(m[3])) return null
  const kind = QUERY_SEGMENTS.includes(m[2].toLowerCase()) ? 'query' : 'script'
  return { kind, id: m[3], stack: m[1].toLowerCase() }
}

// ── Diagnostic log (feedback #129) ───────────────────────────
/** The JSON body of a webRequest requestBody (raw bytes or form fields), or null. */
export function decodeRequestBody(requestBody) {
  try {
    if (requestBody?.raw?.length) {
      const parts = requestBody.raw.filter((p) => p?.bytes).map((p) => new Uint8Array(p.bytes))
      const size = parts.reduce((n, p) => n + p.length, 0)
      const all = new Uint8Array(size)
      let at = 0
      for (const p of parts) { all.set(p, at); at += p.length }
      const parsed = JSON.parse(new TextDecoder('utf-8').decode(all))
      return parsed && typeof parsed === 'object' ? parsed : null
    }
    if (requestBody?.formData) {
      const f = requestBody.formData
      const one = (k) => (Array.isArray(f[k]) ? f[k][0] : f[k])
      return Object.fromEntries(Object.keys(f).map((k) => [k, one(k)]))
    }
  } catch { /* not JSON */ }
  return null
}

const UPDATE_TYPES = { 0: 'Overwrite', 1: 'Update', 2: 'Append' }

/**
 * The fields worth keeping from a query or script object (a save body or the GET of
 * the activity). Returns null when it holds no SQL or script.
 */
export function pickActivity(kind, obj) {
  if (!obj || typeof obj !== 'object' || !KINDS[kind]) return null
  // Some bodies wrap the activity ({ query: {...} } or { definition: {...} }).
  const cf = KINDS[kind].contentField
  const o = typeof obj[cf] === 'string' ? obj : [obj[kind], obj.definition].find((w) => w && typeof w[cf] === 'string') || obj
  const content = o[KINDS[kind].contentField]
  if (typeof content !== 'string') return null
  const out = { name: typeof o.name === 'string' ? o.name : '', key: o.key || o.customerKey || '', content }
  if (kind === 'query') {
    out.targetName = o.targetName || o.targetDataExtensionName || ''
    out.targetKey = o.targetKey || ''
    const t = o.targetUpdateTypeName ?? UPDATE_TYPES[o.targetUpdateTypeId]
    out.targetUpdateType = typeof t === 'string' ? t : ''
  }
  return out
}

// Same text, and the same name and target where both say (a save body may leave them out).
const sameField = (x, y) => !x || !y || x === y
const sameContent = (a, b) => !!a && !!b && a.content === b.content && sameField(a.name, b.name) &&
  sameField(a.targetName, b.targetName) && sameField(a.targetUpdateType, b.targetUpdateType)

/**
 * Adds versions (oldest first in `incoming`) to a record. A version identical to the
 * newest stored one is skipped. At most `max` versions are kept (newest first).
 * Returns the new versions array and how many were added.
 */
export function addVersions(existing, incoming, max = DEFAULT_MAX_VERSIONS) {
  const versions = Array.isArray(existing) ? [...existing] : []
  let added = 0
  for (const v of incoming) {
    if (!v || typeof v.content !== 'string') continue
    if (sameContent(versions[0], v)) continue
    versions.unshift(v)
    added++
  }
  const limit = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : DEFAULT_MAX_VERSIONS
  return { versions: versions.slice(0, limit), added }
}

export function makeVersion(picked, { savedAt, source, stack }) {
  return { versionId: `v_${savedAt}_${source === 'before-save' ? 'b' : 's'}`, savedAt, source, stack: stack || null, ...picked }
}

/** Where to read (GET) or write back (PATCH) one activity through Automation Studio. */
export function activityUrl(kind, stack, id) {
  return `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/${KINDS[kind].segment}/${encodeURIComponent(id)}`
}

/**
 * The body that puts a stored version back: the activity as SFMC has it now, with the
 * SQL or script (and name) of the version. Read-only fields are left out.
 */
export function restoreBody(kind, current, version) {
  const READ_ONLY = new Set(['createdDate', 'modifiedDate', 'status', 'statusId', 'isFrozen', 'validatedQueryText'])
  const base = Object.fromEntries(Object.entries(current || {}).filter(([k]) => !READ_ONLY.has(k)))
  const body = { ...base, [KINDS[kind].contentField]: version.content }
  if (version.name) body.name = version.name
  return body
}

/** The versions key of a described activity (utils/activityTypes.js), or null. */
export function versionsKeyFor(objectTypeId, details) {
  const id = Number(objectTypeId) === 300 ? details?.queryDefinitionId : Number(objectTypeId) === 423 ? details?.ssjsActivityId : null
  if (!id) return null
  return recordKey(Number(objectTypeId) === 300 ? 'query' : 'script', id)
}

export function searchRecords(records, text) {
  const q = String(text || '').trim().toLowerCase()
  const list = [...records].sort((a, b) => (b.versions?.[0]?.savedAt || 0) - (a.versions?.[0]?.savedAt || 0))
  if (!q) return list
  return list.filter((r) => [r.name, r.key, r.activityId, r.businessUnit?.name, r.versions?.[0]?.content, r.versions?.[0]?.targetName]
    .some((v) => String(v || '').toLowerCase().includes(q)))
}

/**
 * Line diff of two texts (longest common subsequence), as rows for a side-by-side
 * view: { left, right, type: 'same' | 'changed' | 'removed' | 'added' }.
 * Texts over 2,000 lines each are compared without alignment (too slow otherwise).
 */
export function sideBySideDiff(oldText, newText) {
  const a = String(oldText ?? '').split(/\r?\n/)
  const b = String(newText ?? '').split(/\r?\n/)
  if (a.length > 2000 || b.length > 2000) {
    const n = Math.max(a.length, b.length)
    return Array.from({ length: n }, (_, i) => {
      const l = a[i]; const r = b[i]
      return { left: l ?? null, right: r ?? null, type: l === r ? 'same' : l === undefined ? 'added' : r === undefined ? 'removed' : 'changed' }
    })
  }
  const m = a.length; const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops = []
  let i = 0; let j = 0
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { ops.push({ left: a[i], right: b[j], type: 'same' }); i++; j++ }
    else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ left: null, right: b[j], type: 'added' }); j++ }
    else { ops.push({ left: a[i], right: null, type: 'removed' }); i++ }
  }
  // Pair the removals and additions between two unchanged lines as "changed" lines.
  const rows = []
  for (let k = 0; k < ops.length;) {
    if (ops[k].type === 'same') { rows.push(ops[k]); k++; continue }
    const rem = []; const add = []
    while (k < ops.length && ops[k].type !== 'same') { if (ops[k].type === 'removed') rem.push(ops[k].left); else add.push(ops[k].right); k++ }
    for (let x = 0; x < Math.max(rem.length, add.length); x++) {
      const l = rem[x] ?? null; const r = add[x] ?? null
      rows.push({ left: l, right: r, type: l !== null && r !== null ? 'changed' : l !== null ? 'removed' : 'added' })
    }
  }
  return rows
}
