// Sends a message to the service worker (src/background/index.js) and resolves with
// its reply, or null when the extension context is gone. Never rejects.
export function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? null : reply ?? null))
    } catch {
      resolve(null)
    }
  })
}
