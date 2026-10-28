// Room in chrome.storage.local, which holds 10 MB since the extension gave up
// unlimitedStorage (security review, 2026-10-28). Saved Emails are what grows: each
// version keeps the email's content. Every email keeps at most EMAIL_MAX_VERSIONS, and
// when storage is nearly full the oldest versions of any email go first (the newest
// version of each email is always kept). Saved queries and other records are never
// touched.
import { storageGet, storageSet } from './chromeAsync.js'

export const QUOTA_BYTES = 10 * 1024 * 1024
export const BUDGET_BYTES = 9 * 1024 * 1024 // leave room for queries and settings
export const EMAIL_MAX_VERSIONS = 10

const sizeOf = (v) => JSON.stringify(v ?? null).length

/**
 * Which email versions to drop so that `over` bytes are freed: oldest first across
 * every email, never an email's newest version. Returns { [key]: record without them }
 * for the records that change, and the bytes freed.
 */
export function trimEmailVersions(all, over) {
  const candidates = []
  for (const [key, rec] of Object.entries(all || {})) {
    if (!key.startsWith('email_') || !Array.isArray(rec?.versions)) continue
    rec.versions.slice(1).forEach((v) => candidates.push({ key, v, at: v?.savedAt || 0, bytes: sizeOf(v) }))
  }
  candidates.sort((a, b) => a.at - b.at)
  const drop = new Map() // key -> Set(version)
  let freed = 0
  for (const c of candidates) {
    if (freed >= over) break
    if (!drop.has(c.key)) drop.set(c.key, new Set())
    drop.get(c.key).add(c.v)
    freed += c.bytes
  }
  const changed = {}
  for (const [key, gone] of drop) changed[key] = { ...all[key], versions: all[key].versions.filter((v) => !gone.has(v)) }
  return { changed, freed }
}

function bytesInUse() {
  return new Promise((resolve) => {
    try { chrome.storage.local.getBytesInUse(null, (b) => resolve(b || 0)) } catch { resolve(0) }
  })
}

/** Frees space for `need` more bytes by dropping old email versions. Returns the bytes freed. */
export async function makeRoom(need = 0) {
  const used = await bytesInUse()
  const over = used + need - BUDGET_BYTES
  if (over <= 0) return 0
  const all = await storageGet('local', null)
  const { changed, freed } = trimEmailVersions(all, over)
  if (Object.keys(changed).length) await storageSet('local', changed)
  if (freed) console.warn(`[Toolkit:SW] Storage nearly full: removed old Saved Emails versions (${Math.round(freed / 1024)} KB).`)
  return freed
}
