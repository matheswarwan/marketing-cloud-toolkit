// Admin policy keys (public/managed_schema.json), shared by the pages
// (utils/policy.js) and the service worker (background/policy.js). No Vue here.
export const POLICY_KEYS = [
  'disableHistory', 'disableShare', 'disableFeedback', 'disableFeedbackMetadata',
  'disableScreenshots', 'disableContacts', 'disableDiagramforce',
]

/** Only `true` turns a policy on; anything else (missing, false, a string) leaves it off. */
export function normalizePolicy(raw) {
  return Object.fromEntries(POLICY_KEYS.map((k) => [k, raw?.[k] === true]))
}
