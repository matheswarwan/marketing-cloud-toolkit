// SOAP reads (user, 2026-11-10: triggered send summaries, sends, users and roles).
// The SOAP address is the one the account's own endpoint list names (`platform/v1/endpoints`,
// type soap). On s10 that is webservice.s10.exacttarget.com/Service.asmx, which
// accepts the MCA session token as <fueloauth> (checked live on s10, 2026-11-10). Newer
// stacks have no webservice.<stack> host at all (s11, s12, s13, s50 and s51 do not resolve,
// checked 2026-11-16), so SOAP there failed with "Failed to fetch" (feedback #1102); they
// use the tenant address https://<tenant>.soap.marketingcloudapis.com/Service.asmx.
// webservice.<stack> stays the fallback when the list can't be read. Only Retrieve is built here, for an
// allowlist of object types: the Toolkit is read-only (user, 2026-11-10). The page sends a
// structured request (no raw XML); the service worker has no DOMParser, so the XML answer
// goes back to the page to parse (utils/soapApi.js).

import { getMcaToken, dropMcaToken } from './mcaToken.js'
import { sfmcFetch } from './fetchProxy.js'

export const SOAP_OBJECTS = new Set([
  'AccountUser', 'Role', 'BusinessUnit', 'Send', 'TriggeredSendDefinition', 'TriggeredSendSummary',
  // User, 2026-11-10: subscriber lookup, send settings, import results (all checked live on s10).
  'Subscriber', 'ListSubscriber', 'List', 'BounceEvent', 'UnsubEvent', 'SentEvent',
  'SendClassification', 'SenderProfile', 'ImportResultsSummary', 'ImportDefinition',
  // API idea 16 (user, 2026-11-11): suppression lists and where they apply (not checked live).
  'SuppressionListDefinition', 'SuppressionListContext',
  // User, 2026-11-16 (ideas from VeLens): send problems, lists a send went to, and the
  // engagement feed (forwards, forward opt-ins, inbound SMS).
  'NotSentEvent', 'ListSend', 'ForwardedEmailEvent', 'ForwardedEmailOptInEvent', 'SMSMOEvent',
])
const OPERATORS = new Set(['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual', 'IN', 'like', 'isNull', 'isNotNull', 'between'])
const STACK = /^s\d{1,3}$/i
const NAME = /^[A-Za-z][A-Za-z0-9_.]{0,80}$/
const REQUEST_ID = /^[0-9a-f-]{36}$/i
const CLIENT_ID = /^\d{1,12}$/

export const soapUrl = (stack) => `https://webservice.${stack}.exacttarget.com/Service.asmx`
const ENDPOINTS = (stack) => `https://mc-domainwhitelist-admin-app.${stack}.marketingcloudapps.com/fuelapi/platform/v1/endpoints`
// The only SOAP hosts accepted from the endpoint list (both inside host_permissions).
const SOAP_HOST = /^(?:webservice\.s\d{1,3}\.exacttarget\.com|[a-z0-9-]{1,63}\.soap\.marketingcloudapis\.com)$/i

/** The SOAP address in an endpoint list (`items` of platform/v1/endpoints), or null. */
export function soapUrlFromEndpoints(items) {
  const entry = (Array.isArray(items) ? items : []).find((e) => e?.type === 'soap' && e.url)
  let url
  try { url = new URL(String(entry?.url)) } catch { return null }
  if (url.protocol !== 'https:' || !SOAP_HOST.test(url.hostname)) return null
  return `https://${url.hostname.toLowerCase()}/Service.asmx`
}

const endpointCache = new Map() // stack → Promise<string|null>, kept while the worker lives

/** The account's SOAP address, or null when its endpoint list can't be read. */
export function soapEndpoint(stack, { fetchJson = (url) => sfmcFetch({ url }) } = {}) {
  if (!endpointCache.has(stack)) {
    const p = fetchJson(ENDPOINTS(stack)).then((d) => soapUrlFromEndpoints(d?.items), () => null)
    // A failed read is asked again next time (a session can come back).
    p.then((url) => { if (!url) endpointCache.delete(stack) })
    endpointCache.set(stack, p)
  }
  return endpointCache.get(stack)
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function filterXml(f, tag = 'Filter') {
  if (!f) return ''
  if (f.logical) {
    if (!['AND', 'OR'].includes(f.logical)) throw new Error('Bad filter')
    return `<${tag} xsi:type="ComplexFilterPart">${filterXml(f.left, 'LeftOperand')}<LogicalOperator>${f.logical}</LogicalOperator>${filterXml(f.right, 'RightOperand')}</${tag}>`
  }
  if (!NAME.test(f.property || '') || !OPERATORS.has(f.operator)) throw new Error('Bad filter')
  const values = (Array.isArray(f.values) ? f.values : f.values == null ? [] : [f.values]).slice(0, 2500)
  // SFMC refuses IN with one value ("IN Operator needs more than one values", live test
  // on s10, 2026-11-16): that is an equals.
  const operator = f.operator === 'IN' && values.length === 1 ? 'equals' : f.operator
  const dates = f.dates ? values.map((v) => `<DateValue>${esc(v)}</DateValue>`).join('') : values.map((v) => `<Value>${esc(v)}</Value>`).join('')
  return `<${tag} xsi:type="SimpleFilterPart"><Property>${esc(f.property)}</Property><SimpleOperator>${operator}</SimpleOperator>${dates}</${tag}>`
}

function clientIdsXml(ids) {
  if (ids == null) return ''
  const list = (Array.isArray(ids) ? ids : [ids]).map(String)
  if (!list.length || list.length > 50 || !list.every((id) => CLIENT_ID.test(id))) throw new Error('Bad business unit ID')
  return `<ClientIDs>${list.map((id) => `<ID>${id}</ID>`).join('')}</ClientIDs>`
}

/** The Retrieve envelope (exported for tests). `token` is filled in by soapRetrieve. */
// `clientIds`: business unit MIDs to read in (a parent BU's session reading a child), up to 50.
export function retrieveEnvelope({ stack, objectType, properties = [], filter = null, queryAllAccounts = false, clientIds = null, continueRequest = null }, token, url = soapUrl(stack)) {
  if (!STACK.test(String(stack || ''))) throw new Error('Unknown stack')
  if (!SOAP_OBJECTS.has(objectType)) throw new Error(`Reading ${objectType} is not supported`)
  const props = properties.filter((p) => NAME.test(p)).slice(0, 100)
  const body = continueRequest
    ? `<RetrieveRequest><ContinueRequest>${REQUEST_ID.test(continueRequest) ? continueRequest : ''}</ContinueRequest></RetrieveRequest>`
    : `<RetrieveRequest>${clientIdsXml(clientIds)}${queryAllAccounts ? '<QueryAllAccounts>true</QueryAllAccounts>' : ''}<ObjectType>${objectType}</ObjectType>${props.map((p) => `<Properties>${p}</Properties>`).join('')}${filterXml(filter)}</RetrieveRequest>`
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><s:Header><a:Action s:mustUnderstand="1">Retrieve</a:Action><a:To s:mustUnderstand="1">${esc(url)}</a:To><fueloauth xmlns="http://exacttarget.com">${esc(token || '')}</fueloauth></s:Header><s:Body><RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">${body}</RetrieveRequestMsg></s:Body></s:Envelope>`
}

const authFailed = (status, text) => status === 401 || /Login failed|not authorized|Token Expired|Invalid token/i.test(text || '')

/**
 * One Retrieve call; returns the response XML. Retries once with a fresh token. Sends to
 * the account's SOAP address; when that host can't be reached, tries webservice.<stack>.
 */
export async function soapRetrieve(request, { fetch: doFetch = fetch, token: tokenFor = getMcaToken, drop = dropMcaToken, endpoint = soapEndpoint } = {}) {
  const { stack } = request
  if (!STACK.test(String(stack || ''))) throw new Error('Unknown stack')
  const legacy = soapUrl(stack)
  const urls = [...new Set([await endpoint(stack), legacy].filter(Boolean))]
  const post = async (token) => {
    for (const [i, url] of urls.entries()) {
      try {
        return await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: retrieveEnvelope(request, token, url), credentials: 'omit' })
      } catch (e) {
        // A network failure (no such host, feedback #1102): the next address, else a clear message.
        if (i + 1 < urls.length) continue
        throw new Error(`Could not reach SFMC's SOAP API for ${stack} (${new URL(url).hostname}): ${e?.message || e}`)
      }
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tokenFor(stack)
    if (!token) throw new Error('No Marketing Cloud session for SOAP. Log in to SFMC in any tab, then try again.')
    const res = await post(token)
    const text = await res.text()
    if (attempt === 0 && authFailed(res.status, text)) { drop(stack); continue }
    if (!res.ok && !/<OverallStatus>/.test(text)) throw new Error(`SFMC SOAP error ${res.status}`)
    return text
  }
  throw new Error('SFMC refused the session for SOAP.')
}
