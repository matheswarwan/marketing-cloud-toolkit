// Admin policy (security review, 2026-10-28): values an administrator sets through
// Chrome's managed storage (public/managed_schema.json; deployment notes in
// docs/enterprise-deployment.md). A policy can only turn things off. Pages read
// `policy` (reactive) or `isPolicyOn`; the service worker has its own copy
// (background/policy.js) for the capture features.
import { reactive } from 'vue'
import { normalizePolicy } from './policyKeys.js'

export { POLICY_KEYS, normalizePolicy } from './policyKeys.js'

export const policy = reactive({ loaded: false, ...normalizePolicy({}) })

function apply(raw) {
  Object.assign(policy, normalizePolicy(raw), { loaded: true })
}

let ready = null

/** Reads the policy once and follows changes. Resolves when it has been read (at most 2 s). */
export function loadPolicy() {
  if (ready) return ready
  ready = new Promise((resolve) => {
    const read = () => {
      try {
        chrome.storage.managed.get(null, (r) => { void chrome.runtime.lastError; apply(r || {}); resolve() })
      } catch { apply({}); resolve() } // not in an extension, or no managed storage
    }
    read()
    try { chrome.storage.onChanged.addListener((_, area) => { if (area === 'managed') read() }) } catch { /* no storage events */ }
    setTimeout(() => { if (!policy.loaded) apply({}); resolve() }, 2000)
  })
  return ready
}

export const isPolicyOn = (key) => policy[key] === true

/** Routes hidden by a policy. */
export function routeBlocked(path) {
  return path.startsWith('/contacts') && isPolicyOn('disableContacts')
}

export const POLICY_NOTE = 'Turned off by your organization\'s policy.'
