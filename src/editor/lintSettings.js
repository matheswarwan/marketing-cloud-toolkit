// Lint rules the user turned off (with "Turn off QSxxx" on a lint message), kept in
// chrome.storage.local so every panel and tab shares them.

const KEY = 'lintDisabledRules'
let disabled = new Set()
const listeners = new Set()

function notify() {
  listeners.forEach(fn => { try { fn(disabled) } catch {} })
}

try {
  chrome.storage?.local?.get(KEY, (r) => {
    disabled = new Set(Array.isArray(r?.[KEY]) ? r[KEY] : [])
    notify()
  })
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return
    disabled = new Set(Array.isArray(changes[KEY].newValue) ? changes[KEY].newValue : [])
    notify()
  })
} catch {}

/** Rule codes the user turned off. */
export function disabledRules() {
  return disabled
}

/** Turns a rule off (or back on) everywhere. */
export function setRuleDisabled(code, off = true) {
  const next = new Set(disabled)
  if (off) next.add(code)
  else next.delete(code)
  disabled = next
  notify()
  try { chrome.storage?.local?.set({ [KEY]: [...next].sort() }) } catch {}
}

/** Calls `fn(disabledSet)` on every change. Returns an unsubscribe function. */
export function onLintSettingsChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
