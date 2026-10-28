// Promise wrappers around the callback-style chrome APIs the service worker uses.
// Every helper resolves (never rejects), so a missing API in a test or an older
// Chrome degrades to "nothing found".

export function storageGet(area, keys) {
  return new Promise((resolve) => {
    try { chrome.storage[area].get(keys, (r) => resolve(r || {})) } catch { resolve({}) }
  })
}

export function storageSet(area, items) {
  return new Promise((resolve) => {
    try { chrome.storage[area].set(items, () => resolve()) } catch { resolve() }
  })
}

export function storageRemove(area, keys) {
  return new Promise((resolve) => {
    try { chrome.storage[area].remove(keys, () => resolve()) } catch { resolve() }
  })
}

export function queryTabs(queryInfo = {}) {
  return new Promise((resolve) => {
    try { chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || [])) } catch { resolve([]) }
  })
}

export function getCookie(details) {
  return new Promise((resolve) => {
    try { chrome.cookies.get(details, (c) => resolve(c || null)) } catch { resolve(null) }
  })
}

export function getAllCookies(details) {
  return new Promise((resolve) => {
    try { chrome.cookies.getAll(details, (c) => resolve(c || [])) } catch { resolve([]) }
  })
}

export function createTab(props) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.create(props, (tab) => resolve(chrome.runtime.lastError ? null : tab || null))
    } catch {
      resolve(null)
    }
  })
}

export function removeTab(tabId) {
  try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError) } catch { /* already gone */ }
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
