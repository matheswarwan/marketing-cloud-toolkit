// Tabs the app opens go right after the tab that asked for them, not at the end
// of the window (feedback #74).

/** Tab properties that place a new tab right after `tab` in its window. */
export function nextTo(tab, props = {}) {
  if (!tab || typeof tab.index !== 'number') return { ...props }
  const out = { ...props, index: tab.index + 1 }
  if (tab.windowId !== undefined) out.windowId = tab.windowId
  if (tab.id !== undefined) out.openerTabId = tab.id
  return out
}

/** Opens a tab next to the extension page this runs in. Resolves to the tab or null. */
export function openTab(props) {
  return new Promise((resolve) => {
    const create = (current) => {
      try {
        chrome.tabs.create(nextTo(current, props), (tab) => resolve(chrome.runtime.lastError ? null : tab || null))
      } catch {
        resolve(null)
      }
    }
    try {
      chrome.tabs.getCurrent((current) => { void chrome.runtime.lastError; create(current || null) })
    } catch {
      create(null)
    }
  })
}
