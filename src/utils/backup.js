// Backup files: everything SFMC Query Saver or Marketing Cloud Toolkit keeps (saved queries with
// their run history, captured email versions, Query and Script activity versions,
// workspaces, settings) as one JSON file.
// Query Saver exports this format so its data can move into the Toolkit.
//
// { format: 'sfmc-query-saver-backup', version: 1, app, appVersion, exportedAt, items }

export const BACKUP_FORMAT = 'sfmc-query-saver-backup'
export const BACKUP_VERSION = 1

// Settings worth carrying over. Session state (stack, CSRF tokens, the old analytics id,
// "seen" flags) is left out.
export const BACKUP_SETTINGS = [
  '_emailSaverEnabled', '_emailSaveDebounce', '_reuseQueryDE', 'cardSize',
  'sfmcqs_theme', 'sfmcqs_settings', 'lintDisabledRules',
  '_activitySaverEnabled', '_activityMaxVersions',
]

const RECORD_RE = /^(sql|email|workspace|activity)_/

export function recordKind(key, value) {
  if (!RECORD_RE.test(key) || !value || typeof value !== 'object') return null
  if (key.startsWith('sql_') && typeof value.queryText === 'string') return 'queries'
  if (key.startsWith('email_') && value.assetId != null) return 'emails'
  if (key.startsWith('workspace_') && Array.isArray(value.panels)) return 'workspaces'
  if (/^activity_(query|script)_/.test(key) && Array.isArray(value.versions)) return 'activities'
  return null
}

export function buildBackup(storage, { app, appVersion, now = new Date() }) {
  const items = {}
  for (const [key, value] of Object.entries(storage || {})) {
    if (recordKind(key, value) || BACKUP_SETTINGS.includes(key)) items[key] = value
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, app, appVersion, exportedAt: now.toISOString(), items }
}

export function backupFileName(app, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${app}-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

export function parseBackup(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  if (data?.format !== BACKUP_FORMAT || typeof data.items !== 'object' || !data.items) {
    throw new Error('This is not an SFMC Query Saver or Marketing Cloud Toolkit backup file.')
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version. Update Marketing Cloud Toolkit and try again.')
  }
  return data
}

function mergeVersions(current, incoming) {
  const byId = new Map()
  for (const v of [...(current || []), ...(incoming || [])]) if (v?.versionId && !byId.has(v.versionId)) byId.set(v.versionId, v)
  return [...byId.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}

/**
 * What importing `items` into `existing` storage writes. Nothing already here is
 * overwritten: new records are added; an email already here gains the versions it is
 * missing; a setting is only set when it isn't set yet (turned-off lint rules are
 * combined).
 *
 * @returns {{ writes: object, added: object, merged: object, skipped: object }}
 *   counts per kind: queries, emails, activities, workspaces, settings
 */
export function planImport(items, existing) {
  const zero = () => ({ queries: 0, emails: 0, activities: 0, workspaces: 0, settings: 0 })
  const added = zero()
  const merged = zero()
  const skipped = zero()
  const writes = {}

  for (const [key, value] of Object.entries(items || {})) {
    const kind = recordKind(key, value)
    if (kind) {
      const cur = existing[key]
      if (!cur) { writes[key] = value; added[kind]++; continue }
      if (kind === 'emails' || kind === 'activities') {
        const versions = mergeVersions(cur.versions, value.versions)
        if (versions.length > (cur.versions?.length || 0)) {
          writes[key] = { ...cur, versions }
          merged[kind]++
          continue
        }
      }
      skipped[kind]++
      continue
    }
    if (!BACKUP_SETTINGS.includes(key)) continue
    if (key === 'lintDisabledRules' && Array.isArray(value)) {
      const union = [...new Set([...(existing[key] || []), ...value])].sort()
      if (union.length !== (existing[key] || []).length) { writes[key] = union; added.settings++ } else skipped.settings++
      continue
    }
    if (existing[key] === undefined) { writes[key] = value; added.settings++ } else skipped.settings++
  }
  return { writes, added, merged, skipped }
}

export function describeImport({ added, merged, skipped }) {
  const parts = []
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`
  if (added.queries) parts.push(n(added.queries, 'query', 'queries'))
  if (added.emails) parts.push(n(added.emails, 'email', 'emails'))
  if (added.activities) parts.push(n(added.activities, 'activity history', 'activity histories'))
  if (added.workspaces) parts.push(n(added.workspaces, 'workspace', 'workspaces'))
  if (added.settings) parts.push(n(added.settings, 'setting', 'settings'))
  let text = parts.length ? `Imported ${parts.join(', ')}.` : 'Nothing new to import.'
  if (merged.emails) text += ` Added missing versions to ${n(merged.emails, 'email', 'emails')}.`
  if (merged.activities) text += ` Added missing versions to ${n(merged.activities, 'activity', 'activities')}.`
  const already = skipped.queries + skipped.emails + skipped.activities + skipped.workspaces
  if (already) text += ` ${already} already here, kept as they are.`
  return text
}
