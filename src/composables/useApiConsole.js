import { ref } from 'vue'
import { setApiLogCallback } from '@/utils/sfmcApi.js'

// One API console for the whole app: every SFMC call made through sfmcApi.js is
// logged while it is turned on (Settings). The switch is kept in Query Saver's
// `sfmcqs_settings.apiConsole`.
const SETTINGS_KEY = 'sfmcqs_settings'
const MAX_LOGS = 200

const enabled = ref(false)
const logs = ref([])
let started = false

function start() {
  if (started) return
  started = true
  try {
    chrome.storage.local.get(SETTINGS_KEY, (r) => { enabled.value = !!r?.[SETTINGS_KEY]?.apiConsole })
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) enabled.value = !!changes[SETTINGS_KEY].newValue?.apiConsole
    })
  } catch { /* not in an extension */ }
  setApiLogCallback((entry) => {
    if (enabled.value) logs.value = [entry, ...logs.value].slice(0, MAX_LOGS)
  })
}

function setEnabled(on) {
  enabled.value = on
  try {
    chrome.storage.local.get(SETTINGS_KEY, (r) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...(r?.[SETTINGS_KEY] || {}), apiConsole: on } })
    })
  } catch { /* not in an extension */ }
}

export function formatLogLine(entry) {
  const ts = new Date(entry.ts).toISOString()
  if (entry.type === 'info') return `[${ts}] INFO ${entry.message}`
  if (entry.type === 'req') return `[${ts}] REQ  ${entry.method} ${entry.url}${entry.body != null ? `\n  body: ${JSON.stringify(entry.body)}` : ''}`
  if (entry.type === 'res') return `[${ts}] RES  ${entry.method} ${entry.url}\n  -> ${JSON.stringify(entry.result)}`
  return `[${ts}] ERR  ${entry.method} ${entry.url}\n  x ${entry.error}`
}

export function useApiConsole() {
  start()
  return { enabled, logs, setEnabled, clear: () => { logs.value = [] } }
}
