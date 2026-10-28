// Updates (feedback #48). Chrome installs a new version when the extension is
// idle, and an app tab left open all day can put that off. The worker asks Chrome
// to check when it starts (Chrome throttles this) and notes an update that is
// waiting, so the app can offer to restart into it (components/shell/UpdateBanner.vue).
export const UPDATE_KEY = '_updateAvailable'

function note(version) {
  if (version) chrome.storage.local.set({ [UPDATE_KEY]: { version, at: Date.now() } })
}

export function watchForUpdates() {
  chrome.runtime.onUpdateAvailable?.addListener((details) => note(details?.version))
  // The new version is running: nothing is waiting any more.
  // Also drops the random id the removed Google Analytics events used (2.0.18).
  chrome.runtime.onInstalled?.addListener(() => chrome.storage.local.remove([UPDATE_KEY, 'sfmcqs_analytics_cid']))
  try {
    chrome.runtime.requestUpdateCheck?.((status, details) => {
      void chrome.runtime.lastError
      if (status === 'update_available') note(details?.version)
    })
  } catch { /* not available (tests, unpacked builds) */ }
}
