export const STACK_CACHE_TTL = 15 * 60 * 1000 // 15 minutes

/**
 * Returns the active SFMC stack ID (e.g. 's51').
 *
 * Asks the background service worker, which resolves the stack in this order
 * (resolveStack in dist/background.js): the user's manual choice, the SFMC tab
 * used most recently, any open SFMC tab, then cookies (several stacks are each
 * checked with a real API call), then the old stack probe.
 *
 * @returns {Promise<string|null>} Stack ID or null if not detected
 */
export function detectStack() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[SFMCQS:detectStack] sendMessage error:', chrome.runtime.lastError.message)
        resolve(null)
        return
      }
      const stackKey = response?.session?.stackKey
      if (stackKey) {
        console.log('[SFMCQS:detectStack] Stack detected:', stackKey)
        chrome.storage.local.set({ sfmcStack: stackKey, sfmcStackTs: Date.now() })
        resolve(stackKey)
      } else {
        console.warn('[SFMCQS:detectStack] No stack detected — open an SFMC tab for automatic detection.')
        resolve(null)
      }
    })
  })
}

/**
 * Reads the cached stack from chrome.storage.local.
 * Returns { stack, isFresh } where isFresh is true if the cache is within STACK_CACHE_TTL.
 *
 * @returns {Promise<{ stack: string|null, isFresh: boolean }>}
 */
export function readCachedStack() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['sfmcStack', 'sfmcStackTs'], (result) => {
      const stack = result.sfmcStack ?? null
      const ts    = result.sfmcStackTs ?? 0
      const isFresh = !!stack && (Date.now() - ts) < STACK_CACHE_TTL
      resolve({ stack, isFresh })
    })
  })
}

/**
 * Calls `cb(stack)` whenever the cached stack changes, for example when the user
 * picks a stack in the Connection Status dropdown or the SW drops a stack that
 * failed auth. Returns an unsubscribe function.
 */
export function onStackChange(cb) {
  const listener = (changes, area) => {
    if (area === 'local' && changes.sfmcStack) cb(changes.sfmcStack.newValue ?? null)
  }
  chrome.storage?.onChanged?.addListener(listener)
  return () => chrome.storage?.onChanged?.removeListener(listener)
}

function ask(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? null : res))
    } catch {
      resolve(null)
    }
  })
}

/** Every stack the SW can see, the one it resolved, and the manual choice (or null). */
export function getStackChoices() {
  return ask({ type: 'GET_STACKS' })
}

/** Pins a stack (e.g. 's10'), or `null` to go back to automatic detection. */
export function setStackOverride(stack) {
  return ask({ type: 'SET_STACK_OVERRIDE', stack: stack || null })
}
