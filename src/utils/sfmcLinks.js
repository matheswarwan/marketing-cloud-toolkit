// Click handler for "open in SFMC" links (feedback #58): the service worker opens the
// tab and puts the deep link back if SFMC drops it on the way in (login, slow shell).
// Ctrl/Cmd/Shift and middle clicks keep the browser's own behaviour.
import { sendToBackground } from './messaging.js'

export function openInSfmc(event, url) {
  if (!url || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
  event.preventDefault()
  sendToBackground({ type: 'OPEN_SFMC_LINK', url }).then((r) => {
    if (!r?.ok) window.open(url, '_blank', 'noopener')
  })
}
