// Who may send which message (security review, 2026-10-28). The extension's own pages
// may send any message. Content scripts (on SFMC pages and the share page) may send
// only the ones they use, and SFMC_FETCH only as a GET of an automation, which is all
// the Automation Summary tab reads. Web pages cannot message the extension at all
// (no externally_connectable).
const CONTENT_TYPES = new Set(['SFMC_CONTEXT_CAPTURED', 'MCA_TOKEN_CAPTURED', 'OPEN_APP', 'DASHBOARD_SUMMARY', 'IMPORT_SHARED_QUERY', 'SFMC_FETCH'])
const AUTOMATION_GET = /^https:\/\/mc\.[a-z0-9]+\.marketingcloudapps\.com\/AutomationStudioFuel3\/fuelapi\/automation\/v1\/automations\/[A-Za-z0-9%-]+$/

/** Whether `message` from `sender` may be handled. */
export function messageAllowed(message, sender, extensionOrigin) {
  if (sender?.url && String(sender.url).startsWith(extensionOrigin)) return true
  const type = message?.type
  if (!CONTENT_TYPES.has(type)) return false
  if (type === 'SFMC_FETCH') return String(message.method || 'GET').toUpperCase() === 'GET' && !message.body && AUTOMATION_GET.test(String(message.url || ''))
  return true
}
