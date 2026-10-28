// The admin policy for the service worker (see utils/policy.js and
// public/managed_schema.json). Read once and kept up to date; a failed read means
// no policy.
import { normalizePolicy } from '../utils/policyKeys.js'

let current = normalizePolicy({})
let ready = null

function read() {
  return new Promise((resolve) => {
    try {
      chrome.storage.managed.get(null, (r) => { void chrome.runtime.lastError; current = normalizePolicy(r || {}); resolve(current) })
    } catch { resolve(current) }
  })
}

export function watchPolicy() {
  ready = read()
  try {
    chrome.storage.onChanged.addListener((_, area) => { if (area === 'managed') ready = read() })
  } catch { /* no storage events */ }
}

/** The policy as last read (for synchronous webRequest listeners). */
export const policyNow = () => current

/** The policy, once it has been read. */
export async function getPolicy() {
  if (!ready) ready = read()
  return ready
}
