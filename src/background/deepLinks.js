// Opens an SFMC deep link (an automation, activity or journey) in a new tab and keeps
// it (feedback #58). When the SFMC session has expired or the shell is still starting,
// SFMC goes through login or its home page and drops everything after `#`, so the tab
// lands on the app's home page instead of the item. If the tab comes back to the same
// stack's /cloud/ page without the link's `#app/...` part, the link is put back once.
import { nextTo } from '../utils/openTab.js'

const WATCH_FOR = 3 * 60 * 1000

/** True when `now` is the stack's SFMC shell without the deep part of `wanted`. */
export function lostDeepLink(wanted, now) {
  try {
    const w = new URL(wanted)
    const n = new URL(now)
    if (n.host !== w.host || !n.pathname.startsWith('/cloud')) return false
    // The part that names the item, e.g. AutomationStudioFuel3/%23Instance/<id>.
    const want = decodeURIComponent(w.hash)
    const have = decodeURIComponent(n.hash)
    return want.length > 1 && have !== want && !have.startsWith(want)
  } catch {
    return false
  }
}

export function openSfmcLink(url, fromTab = null) {
  return new Promise((resolve) => {
    let tabId = null
    let restored = false
    let leftShell = false
    const stop = () => { try { chrome.tabs.onUpdated.removeListener(onUpdated) } catch { /* ignore */ } }
    const onUpdated = (id, info, tab) => {
      if (id !== tabId || restored) return
      const now = info.url || tab?.url || ''
      if (!now) return
      // Only after the tab has been somewhere else (login) or SFMC rewrote the URL.
      if (!now.startsWith(url) && !lostDeepLink(url, now)) leftShell = true
      if (info.status === 'complete' && lostDeepLink(url, tab?.url || now) && (leftShell || tab?.url !== url)) {
        restored = true
        stop()
        chrome.tabs.update(id, { url }, () => void chrome.runtime.lastError)
      }
    }
    try {
      chrome.tabs.onUpdated.addListener(onUpdated)
      chrome.tabs.create(nextTo(fromTab, { url }), (tab) => {
        if (chrome.runtime.lastError || !tab) { stop(); resolve({ ok: false }); return }
        tabId = tab.id
        setTimeout(stop, WATCH_FOR)
        resolve({ ok: true })
      })
    } catch {
      stop()
      resolve({ ok: false })
    }
  })
}
