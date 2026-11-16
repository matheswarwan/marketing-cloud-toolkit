// Read-only SOAP Retrieve from extension pages (user, 2026-11-10). The service worker
// builds the envelope and adds the session token (background/soap.js); this module sends
// the structured request, parses the XML answer and follows MoreDataAvailable pages.

export const SOAP_PAGE_LIMIT = 20 // 2,500 rows a page: up to 50,000 rows

function send(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'SFMC_SOAP_RETRIEVE', request }, (response) => {
      const error = chrome.runtime.lastError?.message || response?.error || (response ? null : 'No reply from the extension service worker.')
      if (error) return reject(new Error(error))
      resolve(response.data)
    })
  })
}

// An element as a plain value: text, or an object of its children (repeated names
// become arrays; xsi:nil is null). Namespaces are dropped.
function toValue(el) {
  if (el.getAttribute('xsi:nil') === 'true' || el.getAttributeNS?.('http://www.w3.org/2001/XMLSchema-instance', 'nil') === 'true') return null
  const kids = [...el.children]
  if (!kids.length) return el.textContent
  const out = {}
  for (const k of kids) {
    const name = k.localName
    const v = toValue(k)
    if (name in out) out[name] = Array.isArray(out[name]) ? [...out[name], v] : [out[name], v]
    else out[name] = v
  }
  return out
}

/** { status, message, requestId, results[] } from a RetrieveResponseMsg. */
export function parseRetrieve(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml')
  const one = (name) => doc.getElementsByTagNameNS('*', name)[0]?.textContent ?? null
  const fault = one('faultstring') || doc.getElementsByTagNameNS('*', 'Text')[0]?.textContent
  if (!doc.getElementsByTagNameNS('*', 'OverallStatus').length) throw new Error(fault ? `SFMC SOAP: ${fault}` : 'SFMC sent an answer that is not a SOAP response.')
  const results = [...doc.getElementsByTagNameNS('*', 'Results')].map(toValue)
  return { status: one('OverallStatus'), message: one('StatusMessage'), requestId: one('RequestID'), results }
}

/** Arrays for a field that can repeat (Roles.Role). */
export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/**
 * Every result of a Retrieve, following MoreDataAvailable up to `pageLimit` pages (2,500
 * rows each); `rows.capped` is true when SFMC had more.
 * `onPage(rows, total)` gets each page. An "Error: ..." status throws with SFMC's text.
 */
export async function soapRetrieveAll(stack, objectType, properties, { filter = null, queryAllAccounts = false, clientIds = null, onPage = null, retrieve = send, pageLimit = SOAP_PAGE_LIMIT } = {}) {
  let page = parseRetrieve(await retrieve({ stack, objectType, properties, filter, queryAllAccounts, ...(clientIds ? { clientIds } : {}) }))
  const rows = []
  for (let i = 0; ; i++) {
    if (/^Error/i.test(page.status || '')) throw new Error(`SFMC SOAP: ${page.status}${page.message ? ` ${page.message}` : ''}`)
    rows.push(...page.results)
    onPage?.(page.results, rows.length)
    if (!/MoreDataAvailable/i.test(page.status || '') || !page.requestId || i + 1 >= pageLimit) { if (/MoreDataAvailable/i.test(page.status || '')) rows.capped = true; break }
    page = parseRetrieve(await retrieve({ stack, objectType, properties, continueRequest: page.requestId }))
  }
  return rows
}
