// What takes space in chrome.storage.local (feedback #47): saved queries, email
// versions and workspaces, each split by business unit, so one part can be deleted
// instead of everything. Sizes are the JSON length in bytes, close to what Chrome
// counts.
import { recordKind } from './backup.js'

const encoder = new TextEncoder()
export const entryBytes = (key, value) => encoder.encode(key + JSON.stringify(value ?? null)).length

const LABELS = { queries: 'Saved queries', emails: 'Email versions', workspaces: 'Run Query workspaces', other: 'Settings and other' }

function groupOf(kind, value, buNames) {
  if (kind === 'queries') {
    const bu = value.businessUnit
    return bu?.name ? { id: `bu:${bu.accountId ?? bu.name}`, label: bu.name } : { id: 'bu:none', label: 'No business unit recorded' }
  }
  if (kind === 'emails') {
    const mid = value.memberId ?? value.versions?.[0]?.assetBody?.memberId
    // Email records keep only the MID; saved queries know the name for the same MID.
    const name = buNames.get(String(mid))
    return mid ? { id: `mid:${mid}`, label: `${name || `Business unit ${mid}`}${value.stack ? ` (${value.stack})` : ''}` } : { id: 'mid:none', label: 'No business unit recorded' }
  }
  return { id: 'all', label: LABELS[kind] }
}

/** { total, categories: [{ id, label, bytes, count, versions?, groups: [{ id, label, bytes, count, keys }] }] }, biggest first. */
export function storageReport(items) {
  const cats = {}
  let total = 0
  const buNames = new Map()
  for (const [key, value] of Object.entries(items || {})) {
    const bu = recordKind(key, value) === 'queries' ? value.businessUnit : null
    if (bu?.accountId != null && bu.name) buNames.set(String(bu.accountId), bu.name)
  }
  for (const [key, value] of Object.entries(items || {})) {
    const kind = recordKind(key, value) || 'other'
    const bytes = entryBytes(key, value)
    total += bytes
    const cat = (cats[kind] ||= { id: kind, label: LABELS[kind], bytes: 0, count: 0, versions: 0, groups: {} })
    cat.bytes += bytes
    cat.count += 1
    if (kind === 'emails') cat.versions += Array.isArray(value.versions) ? value.versions.length : 0
    const g = groupOf(kind, value, buNames)
    const group = (cat.groups[g.id] ||= { ...g, bytes: 0, count: 0, keys: [] })
    group.bytes += bytes
    group.count += 1
    group.keys.push(key)
  }
  const categories = Object.values(cats)
    .map((c) => ({ ...c, groups: Object.values(c.groups).sort((a, b) => b.bytes - a.bytes) }))
    .sort((a, b) => b.bytes - a.bytes)
  return { total, categories }
}

/**
 * Email records with versions beyond the newest `keep` trimmed; returns
 * { updates: { key: record }, removedVersions, savedBytes } (nothing to write when
 * every email already has `keep` or fewer).
 */
export function trimEmailVersions(items, keep) {
  const updates = {}
  let removedVersions = 0
  let savedBytes = 0
  for (const [key, value] of Object.entries(items || {})) {
    if (recordKind(key, value) !== 'emails' || !Array.isArray(value.versions) || value.versions.length <= keep) continue
    const versions = [...value.versions].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, keep)
    const next = { ...value, versions }
    removedVersions += value.versions.length - versions.length
    savedBytes += entryBytes(key, value) - entryBytes(key, next)
    updates[key] = next
  }
  return { updates, removedVersions, savedBytes }
}

export function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`
}
