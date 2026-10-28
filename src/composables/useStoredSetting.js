import { ref, watch } from 'vue'

// A ref kept in chrome.storage.local under `key`. Changes from other tabs (or the
// service worker) flow back in. `parse` maps the stored value (or undefined) to the
// ref's value.
export function useStoredSetting(key, fallback, parse = (v) => (v === undefined ? fallback : v)) {
  const value = ref(fallback)
  const loaded = ref(false)
  let fromStorage = false

  const apply = (v) => {
    fromStorage = true
    value.value = parse(v)
    queueMicrotask(() => { fromStorage = false })
  }

  try {
    chrome.storage.local.get(key, (r) => { apply(r?.[key]); loaded.value = true })
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && key in changes) apply(changes[key].newValue)
    })
  } catch { loaded.value = true }

  watch(value, (v) => {
    if (fromStorage) return
    try { chrome.storage.local.set({ [key]: v }) } catch { /* not in an extension */ }
  })

  return { value, loaded }
}
