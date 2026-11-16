// SOAP reads (user, 2026-11-10: triggered send summaries, sends, users and roles).
// SFMC's SOAP endpoint for the stack (https://webservice.<stack>.exacttarget.com/Service.asmx,
// inside the existing *.exacttarget.com host permission) accepts the MCA session token as
// <fueloauth> (checked live on s10, 2026-11-10). Only Retrieve is built here, for an
// allowlist of object types: the Toolkit is read-only (user, 2026-11-10). The page sends a
// structured request (no raw XML); the service worker has no DOMParser, so the XML answer
// goes back to the page to parse (utils/soapApi.js).

import { getMcaToken, dropMcaToken } from './mcaToken.js'

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
export function retrieveEnvelope({ stack, objectType, properties = [], filter = null, queryAllAccounts = false, clientIds = null, continueRequest = null }, token) {
  if (!STACK.test(String(stack || ''))) throw new Error('Unknown stack')
  if (!SOAP_OBJECTS.has(objectType)) throw new Error(`Reading ${objectType} is not supported`)
  const props = properties.filter((p) => NAME.test(p)).slice(0, 100)
  const body = continueRequest
    ? `<RetrieveRequest><ContinueRequest>${REQUEST_ID.test(continueRequest) ? continueRequest : ''}</ContinueRequest></RetrieveRequest>`
    : `<RetrieveRequest>${clientIdsXml(clientIds)}${queryAllAccounts ? '<QueryAllAccounts>true</QueryAllAccounts>' : ''}<ObjectType>${objectType}</ObjectType>${props.map((p) => `<Properties>${p}</Properties>`).join('')}${filterXml(filter)}</RetrieveRequest>`
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><s:Header><a:Action s:mustUnderstand="1">Retrieve</a:Action><a:To s:mustUnderstand="1">${soapUrl(stack)}</a:To><fueloauth xmlns="http://exacttarget.com">${esc(token || '')}</fueloauth></s:Header><s:Body><RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">${body}</RetrieveRequestMsg></s:Body></s:Envelope>`
}

const authFailed = (status, text) => status === 401 || /Login failed|not authorized|Token Expired|Invalid token/i.test(text || '')

/** One Retrieve call; returns the response XML. Retries once with a fresh token. */
export async function soapRetrieve(request, { fetch: doFetch = fetch, token: tokenFor = getMcaToken, drop = dropMcaToken } = {}) {
  const { stack } = request
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tokenFor(stack)
    if (!token) throw new Error('No Marketing Cloud session for SOAP. Log in to SFMC in any tab, then try again.')
    const res = await doFetch(soapUrl(stack), { method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' }, body: retrieveEnvelope(request, token), credentials: 'omit' })
    const text = await res.text()
    if (attempt === 0 && authFailed(res.status, text)) { drop(stack); continue }
    if (!res.ok && !/<OverallStatus>/.test(text)) throw new Error(`SFMC SOAP error ${res.status}`)
    return text
  }
  throw new Error('SFMC refused the session for SOAP.')
}
