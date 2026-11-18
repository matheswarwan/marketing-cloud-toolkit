// What Run Query shows when it opens (feedback #1111): the panels from last time, or one
// empty panel. Settings > Running queries picks it; the default, "auto", learns from what
// the user does right after Run Query opens:
//   opened with the last panels: Start fresh = 'fresh', running a reopened query = 'kept'
//   opened empty:                Reopen last panels = 'kept', running the new query = 'fresh'
// Only the first of these per opening counts. The last CHOICES_KEPT choices are kept; with
// at least MIN_CHOICES of them, Run Query opens empty when 'fresh' wins.

export const START_SETTING = '_runQueryOpenWith' // 'auto' | 'last' | 'empty'
export const CHOICES_KEY = 'toolkit_runQueryStartChoices'
export const CHOICES_KEPT = 10
export const MIN_CHOICES = 3

export function parseStartSetting(v) {
  return v === 'last' || v === 'empty' ? v : 'auto'
}

export function cleanChoices(v) {
  return Array.isArray(v) ? v.filter((c) => c === 'fresh' || c === 'kept').slice(-CHOICES_KEPT) : []
}

/** 'last' or 'empty': what Run Query opens with for this setting and these choices. */
export function effectiveStart(setting, choices) {
  const mode = parseStartSetting(setting)
  if (mode !== 'auto') return mode
  const list = cleanChoices(choices)
  if (list.length < MIN_CHOICES) return 'last'
  const fresh = list.filter((c) => c === 'fresh').length
  return fresh > list.length - fresh ? 'empty' : 'last'
}

export function addChoice(choices, choice) {
  return cleanChoices([...cleanChoices(choices), choice])
}

function storageGet(keys) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(keys, (r) => resolve(r || {})) } catch { resolve({}) }
  })
}
function storageSet(obj) {
  try { chrome.storage.local.set(obj) } catch { /* not in an extension */ }
}

export async function loadStartPrefs() {
  const r = await storageGet([START_SETTING, CHOICES_KEY])
  const setting = parseStartSetting(r[START_SETTING])
  const choices = cleanChoices(r[CHOICES_KEY])
  return { setting, choices, start: effectiveStart(setting, choices) }
}

// One opening of Run Query waiting for its first choice (module state: one Run Query
// page per tab). `opened` is 'last' or 'empty'; `reopened` the query IDs shown from last time.
let pending = null

export function beginOpening(opened, reopened = []) {
  pending = { opened, reopened: new Set(reopened) }
}
export function endOpening() { pending = null }

/**
 * Records the first choice of this opening. Returns { changedTo } when, with the
 * "auto" setting, the choice changes what Run Query opens with next time.
 */
export async function noteChoice(choice) {
  if (!pending) return null
  pending = null
  const { setting, choices } = await loadStartPrefs()
  const before = effectiveStart(setting, choices)
  const next = addChoice(choices, choice)
  storageSet({ [CHOICES_KEY]: next })
  const after = effectiveStart(setting, next)
  return setting === 'auto' && after !== before ? { changedTo: after } : null
}

/** A run started in panel `queryId`: which choice that is, if any, for this opening. */
export function choiceForRun(queryId) {
  if (!pending) return null
  if (pending.opened === 'last') return pending.reopened.has(queryId) ? 'kept' : null
  return pending.reopened.has(queryId) ? null : 'fresh'
}

export function changeNotice(changedTo) {
  return changedTo === 'empty'
    ? 'You usually start fresh, so Run Query will now open with one empty panel. Change this in Settings > Running queries.'
    : 'You usually go back to your last queries, so Run Query will now reopen them. Change this in Settings > Running queries.'
}
