// SFMC Setup data (user, 2026-11-05): sender authentication domains, custom (SSL)
// domains, the account's API endpoints and installed package secret expirations.
// The calls are the ones SFMC's own Setup screens make (user's network log on s12;
// checked live on s10, live test, 2026-11-07): From Address Management uses email-app,
// Domain SSL Certificates custom-domains-ui, Domain Allowlist mc-domainwhitelist-admin-app,
// each with its own session cookie (no Bearer token). Those hosts are apps in
// background/apps.js (covered by the *.marketingcloudapps.com permission), which also
// start their sessions the way Setup does. Secret expirations is a core call.
import { ref } from 'vue'
import { sfmcFetch } from './sfmcApi.js'
import { coreOrigin } from './sfmcHosts.js'
import { soapRetrieveAll } from './soapApi.js'
import { noStackError } from './stackDetection.js'
import { fetchTriggeredSends, fetchTmsDefinitions } from './messagingApi.js'

const EMAIL_APP = (stack) => `https://email-app.${stack}.marketingcloudapps.com/fuelapi/messaging/v1`
const CUSTOM_DOMAINS = (stack) => `https://custom-domains-ui.${stack}.marketingcloudapps.com/fuelapi/internal/v1/ssl/customdomains/`
const ENDPOINTS = (stack) => `https://mc-domainwhitelist-admin-app.${stack}.marketingcloudapps.com/fuelapi/platform/v1/endpoints`
const SECRETS = (stack) => `${coreOrigin(stack)}/cloud/fuelapi/internal/v1/packages/secretexpirations`

const PAGE_SIZE = 50
const MAX_PAGES = 40

const lower = (s) => String(s || '').trim().toLowerCase()

/** Domain type labels, as Setup names them. */
export const DOMAIN_TYPES = {
  SAP: 'Sender Authentication Package',
  PrivateDomain: 'Private Domain',
  UserDomain: 'Verified From address',
}

/**
 * One domainverification item. UserDomain entries are email addresses (a verified
 * From address); `mailDomain` is the domain part. SAP and PrivateDomain are domains.
 */
export function normalizeSenderDomain(r) {
  const domain = lower(r?.domain)
  const at = domain.lastIndexOf('@')
  return {
    domain,
    type: r?.domainType || '',
    status: r?.status || '',
    sendable: r?.isSendable === true,
    memberId: r?.memberId ?? null,
    enterpriseId: r?.enterpriseId ?? null,
    emailSendTime: r?.emailSendTime || '',
    isAddress: at > 0,
    mailDomain: at > 0 ? domain.slice(at + 1) : domain,
  }
}

/** Every sender domain and verified From address, all pages. */
export async function fetchSenderDomains(stack, fetch = sfmcFetch) {
  const out = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await fetch(`${EMAIL_APP(stack)}/domainverification?$page=${page}&$pagesize=${PAGE_SIZE}&$orderby=domain%20asc`, 'GET')
    const items = Array.isArray(d?.items) ? d.items : []
    out.push(...items.map(normalizeSenderDomain))
    const total = Number(d?.count)
    if (items.length < PAGE_SIZE || (Number.isFinite(total) && out.length >= total)) break
  }
  return out
}

/** One custom domain (ssl/customdomains item). */
export function normalizeCustomDomain(item) {
  const d = item?.domainDetail || {}
  return {
    id: d.domainDetailId ?? null,
    name: lower(d.domainName),
    type: d.domainType || '',
    dnsStatus: d.dNSStatus || d.dnsStatus || '',
    tlsStatus: d.tLSStatus || d.tlsStatus || '',
    certOwner: d.certOwner ?? null,
    adminEmail: d.adminEmailAddress || '',
    certExpires: d.certExpirationDate || '',
    lastValidated: d.lastValidatedDate || '',
    errors: Array.isArray(d.errorTypes) ? d.errorTypes : [],
    redirect: d.redirectState || '',
    cnameTarget: lower(d.currentCnameTarget).replace(/\.$/, ''),
    dseValid: d.isDseValid ?? null,
    sni: d.isSni ?? null,
    proxy: d.isProxyConfigured ?? null,
    accounts: (Array.isArray(item?.accounts) ? item.accounts : []).map((a) => ({ mid: a.mid ?? null, name: a.name || '' })),
  }
}

/** Custom domains, all pages, with the certificate allocation and last update. */
export async function fetchCustomDomains(stack, fetch = sfmcFetch) {
  const items = []
  let first = null
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await fetch(`${CUSTOM_DOMAINS(stack)}?$page=${page}&$pageSize=${PAGE_SIZE}&$orderBy=domainName+asc`, 'GET')
    first ||= d || {}
    const batch = Array.isArray(d?.items) ? d.items : []
    items.push(...batch.map(normalizeCustomDomain))
    const total = Number(d?.total)
    if (batch.length < PAGE_SIZE || (Number.isFinite(total) && items.length >= total)) break
  }
  const u = first?.utilizations
  return {
    items,
    total: Number(first?.total ?? items.length),
    lastUpdate: first?.lastUpdate || '',
    utilization: u && Number.isFinite(Number(u.allocated)) ? { allocated: Number(u.allocated), used: Number(u.used) || 0 } : null,
  }
}

// The endpoints an installed package calls, as Salesforce documents them. SFMC's list
// also holds its own internal services (restInternal, jsrest on an xt.local host,
// spellcheck, editorSupportAssetHandler), which no package can reach: those stay out.
const ENDPOINT_LABELS = {
  restAuth: 'REST authentication (OAuth token)',
  restProd: 'REST API',
  soap: 'SOAP API',
  ftp: 'SFTP',
  rest: 'REST API (legacy stack URL)',
}
const ENDPOINT_ORDER = Object.keys(ENDPOINT_LABELS)

/**
 * The account's API endpoints for installed packages, plus its tenant subdomain (the
 * first label of the auth, REST or SOAP host, e.g. mcq9c5q-b403hgdg8-6fnmtjbgm4).
 */
export async function fetchTenantEndpoints(stack, fetch = sfmcFetch) {
  const d = await fetch(ENDPOINTS(stack), 'GET')
  const items = (Array.isArray(d?.items) ? d.items : [])
    .filter((e) => e?.url && Object.hasOwn(ENDPOINT_LABELS, e.type))
    .map((e) => ({ type: e.type, label: ENDPOINT_LABELS[e.type], url: String(e.url) }))
    .sort((a, b) => rank(a.type) - rank(b.type))
  return { items, tenant: tenantSubdomain(items) }
}
const rank = (t) => ENDPOINT_ORDER.indexOf(t)

export function tenantSubdomain(items) {
  for (const e of items || []) {
    const m = String(e.url).match(/^[a-z]+:\/\/([a-z0-9-]+)\.(?:auth|rest|soap|ftp)\.marketingcloud(?:apis|ops)\.com/i)
    if (m) return m[1].toLowerCase()
  }
  return ''
}

/** Installed packages and when their client secret expires. */
export async function fetchSecretExpirations(stack, fetch = sfmcFetch) {
  const d = await fetch(SECRETS(stack), 'GET')
  const list = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []
  return list
    .filter((p) => p && (p.packageId || p.name))
    .map((p) => ({ packageId: p.packageId || '', name: p.name || '', expires: p.secretExpirationUTC || '' }))
    .sort((a, b) => (Date.parse(a.expires) || Infinity) - (Date.parse(b.expires) || Infinity))
}

// ── Automation Studio activity types and your access (user, 2026-11-05) ──
// The list Automation Studio reads for its activity palette ("workers"): each type,
// whether this account and user can use it (hasAccess), and the user's permissions
// on it. Same host as the other Automation Studio calls (app automationStudio).
const AS_WORKERS = (stack) => `https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/legacy/v1/beta/automations/workers/`

// "PredictiveIntelligenceRecommendationActivity" → "Predictive Intelligence Recommendation Activity".
export const spacedName = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim()

/** One activity type: { id, name, access, url, granted: [names], denied: [names] }. */
export function normalizeActivityType(w) {
  const granted = new Set()
  const denied = new Set()
  for (const p of Array.isArray(w?.permissions) ? w.permissions : []) {
    if (!p?.permissionName) continue
    ;(p.hasPermission ? granted : denied).add(p.permissionName)
  }
  // The same permission can be listed twice (Query's Move): granted wins.
  for (const g of granted) denied.delete(g)
  return {
    id: Number(w?.categoryId ?? w?.key) || 0,
    name: spacedName(w?.name),
    access: w?.hasAccess === true,
    url: w?.url || '',
    granted: [...granted],
    denied: [...denied],
    listsPermissions: Array.isArray(w?.permissions),
  }
}

/** Every activity type, with access first and then by name. */
export async function fetchActivityTypeAccess(stack, fetch = sfmcFetch) {
  const d = await fetch(AS_WORKERS(stack), 'GET')
  const list = Array.isArray(d?.entry) ? d.entry : Array.isArray(d?.items) ? d.items : []
  return list.map(normalizeActivityType).sort((a, b) => Number(b.access) - Number(a.access) || a.name.localeCompare(b.name))
}

// ══ SOAP lookups ══════════════════════════════════════════
// Read-only setup lookups (user, 2026-11-10; properties checked live on s10 that day):
// - Business units: SOAP BusinessUnit with QueryAllAccounts (filter ID > 0 returns all),
//   plus a small in-memory cache per stack so other pages can name a MID.
// - Send settings: SOAP SendClassification and SenderProfile, cross-referenced with the
//   triggered sends (TriggeredSendDefinition SendClassification.CustomerKey) and, when the
//   list carries it, transactional definitions' classification key.
// - Import results: SOAP ImportResultsSummary (StartDate filter) joined to ImportDefinition
//   names by CustomerKey.
// SFMC rejects a whole Retrieve when one property is invalid. Business units ask only for
// properties seen working live. Where a list also holds properties from SFMC's object
// reference that were not checked live, a property error retries once with the checked
// list (`retrieveProps`).
const num = (v) => (v == null || v === '' ? null : Number(v))
const opts = (retrieve) => (retrieve ? { retrieve } : {})

/**
 * soapRetrieveAll with `wanted` properties; when SFMC refuses one of them (its error names
 * a property), reads again with the `checked` list only.
 */
export async function retrieveProps(stack, objectType, wanted, checked, options = {}) {
  try {
    return await soapRetrieveAll(stack, objectType, wanted, options)
  } catch (e) {
    if (!/propert/i.test(e?.message || '') || wanted.length === checked.length) throw e
    return soapRetrieveAll(stack, objectType, checked, options)
  }
}

// ── Business units ────────────────────────────────────────
// Every one checked live on s10 (2026-11-10).
const BU_PROPS = ['ID', 'Name', 'ParentID', 'ParentName', 'CustomerKey', 'IsActive', 'CreatedDate', 'ModifiedDate', 'BusinessName', 'AccountType']

export function businessUnitRow(b) {
  return {
    mid: num(b.ID), name: b.Name || '', parentId: num(b.ParentID), parentName: b.ParentName || '', key: b.CustomerKey || '',
    active: b.IsActive === '1' || b.IsActive === 'true', createdDate: b.CreatedDate || '', modifiedDate: b.ModifiedDate || '',
    businessName: b.BusinessName || '', accountType: b.AccountType || '',
  }
}

/** "ENTERPRISE_2" -> "Enterprise 2". */
export const accountTypeLabel = (t) => String(t || '').toLowerCase().split('_').filter(Boolean).map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ')

export async function fetchBusinessUnits(stack, { retrieve } = {}) {
  const rows = await soapRetrieveAll(stack, 'BusinessUnit', BU_PROPS, {
    queryAllAccounts: true, filter: { property: 'ID', operator: 'greaterThan', values: ['0'] }, ...opts(retrieve),
  })
  return rows.map(businessUnitRow)
}

/**
 * Business units in tree order (the enterprise first, each parent before its children,
 * names A to Z within a parent), each with `depth`. A BU whose parent is not in the list
 * is treated as a top level one.
 */
export function businessUnitTree(list) {
  const mids = new Set(list.map((b) => b.mid))
  const kids = new Map()
  for (const b of list) {
    const p = b.parentId && mids.has(b.parentId) && b.parentId !== b.mid ? b.parentId : 0
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p).push(b)
  }
  for (const k of kids.values()) k.sort((a, b) => a.name.localeCompare(b.name))
  const out = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const b of kids.get(parent) || []) {
      if (seen.has(b.mid)) continue
      seen.add(b.mid)
      out.push({ ...b, depth })
      walk(b.mid, depth + 1)
    }
  }
  walk(0, 0)
  for (const b of list) if (!seen.has(b.mid)) out.push({ ...b, depth: 0 }) // cycles, just in case
  return out
}

/**
 * The business unit with MID `mid` in `list` and its path from the top level unit down
 * ({ unit, path }); unit is null when no unit has that MID.
 */
export function findBusinessUnit(list, mid) {
  const n = Number(String(mid ?? '').trim())
  const byMid = new Map((list || []).map((b) => [b.mid, b]))
  const unit = Number.isFinite(n) ? byMid.get(n) || null : null
  const path = []
  for (let b = unit, guard = 0; b && guard < 50; b = b.parentId && b.parentId !== b.mid ? byMid.get(b.parentId) : null, guard++) path.unshift(b)
  return { unit, path }
}

// In-memory cache per stack (lost when the tab closes), so other pages can name a MID.
const buCache = new Map() // stack -> Promise<list>
const buLists = ref({}) // stack -> list, for reactive readers

/** Every business unit of the stack's account, read once per app tab (force reads again). */
export function loadBusinessUnits(stack, { force = false, retrieve } = {}) {
  if (!stack) return Promise.reject(noStackError())
  if (force || !buCache.has(stack)) {
    const p = fetchBusinessUnits(stack, { retrieve }).then((list) => { buLists.value = { ...buLists.value, [stack]: list }; return list })
    p.catch(() => buCache.delete(stack))
    buCache.set(stack, p)
  }
  return buCache.get(stack)
}

/** The name of business unit `mid` on `stack`, or '' when unknown (reads the list once). */
export async function businessUnitName(stack, mid, options) {
  const list = await loadBusinessUnits(stack, options).catch(() => [])
  return list.find((b) => b.mid === Number(mid))?.name || ''
}

/** For components: { units(stack), nameFor(stack, mid), load(stack, opts) }; reactive once loaded. */
export function useBusinessUnits() {
  return {
    units: (stack) => buLists.value[stack] || null,
    nameFor: (stack, mid) => (buLists.value[stack] || []).find((b) => b.mid === Number(mid))?.name || '',
    load: loadBusinessUnits,
  }
}

/** Tests only. */
export function clearBusinessUnitCache() { buCache.clear(); buLists.value = {} }

// ── Send settings ─────────────────────────────────────────
// *_CHECKED: the fallback lists, the properties the 2026-11-10 live notes on s10 name plus
// ObjectID, CustomerKey and Name. The longer lists add properties from SFMC's object reference.
const CLASS_CHECKED = ['ObjectID', 'CustomerKey', 'Name', 'SendClassificationType', 'SenderProfile.CustomerKey', 'SenderProfile.ObjectID', 'DeliveryProfile.CustomerKey']
const CLASS_PROPS = ['ObjectID', 'CustomerKey', 'Name', 'Description', 'SendClassificationType', 'SenderProfile.CustomerKey', 'SenderProfile.ObjectID',
  'DeliveryProfile.CustomerKey', 'DeliveryProfile.ObjectID', 'ArchiveEmail', 'CreatedDate', 'ModifiedDate']
const PROFILE_CHECKED = ['ObjectID', 'CustomerKey', 'Name', 'FromName', 'FromAddress']
const PROFILE_PROPS = ['ObjectID', 'CustomerKey', 'Name', 'Description', 'FromName', 'FromAddress', 'UseDefaultRMMRules', 'AutoForwardToEmailAddress', 'AutoForwardToName',
  'DirectForward', 'AutoReply', 'SenderHeaderEmailAddress', 'SenderHeaderName', 'DataRetentionPeriodLength', 'CreatedDate', 'ModifiedDate']

/** SFMC's SendClassificationType as the UI names it: Marketing is Commercial, Operational is Transactional. */
export function classificationTypeLabel(t) {
  if (/^marketing$/i.test(t || '')) return 'Commercial'
  if (/^operational$/i.test(t || '')) return 'Transactional'
  return t || ''
}

export function classificationRow(c) {
  return {
    id: c.ObjectID || '', key: c.CustomerKey || '', name: c.Name || '', description: c.Description || '', type: c.SendClassificationType || '',
    typeLabel: classificationTypeLabel(c.SendClassificationType), senderProfileKey: c.SenderProfile?.CustomerKey || '', senderProfileId: c.SenderProfile?.ObjectID || '',
    deliveryProfileKey: c.DeliveryProfile?.CustomerKey || '', archiveEmail: c.ArchiveEmail || '', createdDate: c.CreatedDate || '', modifiedDate: c.ModifiedDate || '',
  }
}

export function senderProfileRow(p) {
  const yes = (v) => v === 'true'
  return {
    id: p.ObjectID || '', key: p.CustomerKey || '', name: p.Name || '', description: p.Description || '', fromName: p.FromName || '', fromAddress: p.FromAddress || '',
    useDefaultRmm: yes(p.UseDefaultRMMRules), autoForwardAddress: p.AutoForwardToEmailAddress || '', autoForwardName: p.AutoForwardToName || '',
    directForward: yes(p.DirectForward), autoReply: yes(p.AutoReply), senderHeaderAddress: p.SenderHeaderEmailAddress || '', senderHeaderName: p.SenderHeaderName || '',
    retention: num(p.DataRetentionPeriodLength), createdDate: p.CreatedDate || '', modifiedDate: p.ModifiedDate || '',
  }
}

export const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'aol.com', 'icloud.com']
const MARKETING_WORDS = /\b(newsletters?|promos?|promotions?|promotional|offers?|sales?|campaigns?|deals?|discounts?)\b/i

/** Hints on a sender profile: no From address, or a free mail domain. */
export function senderProfileFlags(p) {
  const flags = []
  const addr = String(p.fromAddress || '').trim()
  if (!addr) flags.push('No From address')
  else {
    const domain = addr.split('@')[1]?.toLowerCase() || ''
    if (FREE_MAIL.includes(domain)) flags.push(`Free mail domain (${domain})`)
  }
  return flags
}

/** True when a send's name reads like marketing (newsletter, promo, offer, sale, campaign). */
export const looksLikeMarketing = (name) => MARKETING_WORDS.test(String(name || '').replace(/[_-]+/g, ' '))

/**
 * Classifications, sender profiles and who uses each classification.
 * Returns { classifications[], profiles[], triggeredSends[], transactional[], notes[] }:
 * each classification has `profile` (its sender profile row or null), `triggered` and
 * `transactional` (the sends using it) and `flags`. Triggered and transactional reads
 * are optional: a failure becomes a note, not an error.
 */
export async function fetchSendSettings(stack, { retrieve, fetch, triggered = fetchTriggeredSends, tms = fetchTmsDefinitions } = {}) {
  const notes = []
  const [classes, profiles, tsds, tmsDefs] = await Promise.all([
    retrieveProps(stack, 'SendClassification', CLASS_PROPS, CLASS_CHECKED, opts(retrieve)),
    retrieveProps(stack, 'SenderProfile', PROFILE_PROPS, PROFILE_CHECKED, opts(retrieve)),
    triggered(stack, opts(retrieve)).catch((e) => { notes.push(`Triggered sends could not be read: ${e.message}`); return [] }),
    (fetch ? tms(stack, 'email', fetch) : tms(stack, 'email')).catch(() => { notes.push('Transactional email definitions could not be read; they are left out of Used by.'); return [] }),
  ])
  const profileRows = profiles.map(senderProfileRow)
  const byProfileKey = new Map(profileRows.map((p) => [p.key, p]))
  const byProfileId = new Map(profileRows.map((p) => [p.id.toLowerCase(), p]))
  const liveTsds = tsds.filter((t) => !/deleted|canceled|moved/i.test(t.status || ''))
  const transactional = tmsDefs.map((d) => ({ key: d.definitionKey || '', name: d.name || '', status: d.status || '', classification: d.classification || d.sendClassification?.customerKey || '' }))
  if (tmsDefs.length && !transactional.some((t) => t.classification)) notes.push('The transactional definitions list does not name a send classification, so they are left out of Used by.')
  const classRows = classes.map(classificationRow).map((c) => {
    const profile = byProfileKey.get(c.senderProfileKey) || byProfileId.get(c.senderProfileId.toLowerCase()) || null
    const triggeredList = liveTsds.filter((t) => t.sendClassification && t.sendClassification === c.key)
    const tmsList = transactional.filter((t) => t.classification && t.classification === c.key)
    const flags = []
    if (c.typeLabel === 'Transactional') {
      const odd = [...triggeredList, ...tmsList].filter((t) => looksLikeMarketing(t.name))
      if (odd.length) flags.push(`Transactional, used by ${odd.length === 1 ? 'a send' : `${odd.length} sends`} whose name reads like marketing: ${odd.slice(0, 3).map((t) => t.name).join(', ')}${odd.length > 3 ? ', ...' : ''}`)
    }
    return { ...c, profile, triggered: triggeredList, transactional: tmsList, usedBy: triggeredList.length + tmsList.length, flags }
  })
  const used = new Map()
  for (const c of classRows) if (c.profile) used.set(c.profile.key, (used.get(c.profile.key) || 0) + 1)
  return {
    classifications: classRows,
    profiles: profileRows.map((p) => ({ ...p, flags: senderProfileFlags(p), classificationCount: used.get(p.key) || 0 })),
    triggeredSends: liveTsds,
    transactional,
    notes,
  }
}

// ── Import results ────────────────────────────────────────
const IMPORT_RESULT_CHECKED = ['ImportDefinitionCustomerKey', 'TaskResultID', 'ImportStatus', 'StartDate', 'DestinationID', 'NumberSuccessful', 'NumberDuplicated', 'NumberErrors', 'TotalRows', 'ImportType']
const IMPORT_RESULT_PROPS = ['ImportDefinitionCustomerKey', 'TaskResultID', 'ImportStatus', 'StartDate', 'EndDate', 'DestinationID', 'NumberSuccessful', 'NumberDuplicated',
  'NumberErrors', 'TotalRows', 'ImportType', 'ObjectID']
const IMPORT_DEF_PROPS = ['ObjectID', 'CustomerKey', 'Name', 'Description']

/**
 * SFMC's "9/25/2026 12:01:13 AM" (and ISO text) as a zone-less ISO string
 * "2026-09-25T00:01:13", the wall clock SFMC reports. '' when it cannot be read.
 */
export function parseSfmcDate(text) {
  const s = String(text || '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i)
  const p2 = (n) => String(n).padStart(2, '0')
  if (m) {
    let h = Number(m[4] || 0)
    if (m[7]) { const pm = /p/i.test(m[7]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
    return `${m[3]}-${p2(m[1])}-${p2(m[2])}T${p2(h)}:${m[5] || '00'}:${m[6] || '00'}`
  }
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/)
  if (iso) return `${iso[1]}T${iso[2].length === 5 ? `${iso[2]}:00` : iso[2]}`
  if (/^0001-01-01/.test(s)) return ''
  return ''
}

/** Seconds between two zone-less ISO strings (null when either is missing or end < start). */
export function durationSeconds(start, end) {
  const a = Date.parse(start || '')
  const b = Date.parse(end || '')
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null
}

/** 75 -> "1 min 15 s". */
export function formatDuration(sec) {
  if (sec == null) return ''
  if (sec < 60) return `${sec} s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h} h ${m} min` : `${m} min${s ? ` ${s} s` : ''}`
}

export function importResultRow(r) {
  const start = parseSfmcDate(r.StartDate)
  const end = parseSfmcDate(r.EndDate)
  return {
    id: r.ObjectID || r.TaskResultID || '', key: r.ImportDefinitionCustomerKey || '', taskResultId: r.TaskResultID || '', status: r.ImportStatus || '',
    start, end, durationSec: durationSeconds(start, end), destinationId: r.DestinationID || '', importType: r.ImportType || '',
    total: num(r.TotalRows), successful: num(r.NumberSuccessful), duplicated: num(r.NumberDuplicated), errors: num(r.NumberErrors),
  }
}

/** Why an import run needs a look: errors, or a status other than Completed. */
export function importResultFlags(r) {
  const flags = []
  if (r.errors > 0) flags.push(`${r.errors.toLocaleString()} error${r.errors === 1 ? '' : 's'}`)
  if (r.status && !/^completed$/i.test(r.status)) flags.push(`Status ${r.status}`)
  return flags
}

/** ISO date `days` days before `now` (a StartDate filter value). */
export const daysAgoIso = (days, now = Date.now()) => new Date(now - days * 86400000).toISOString().slice(0, 19)

/** Names (and descriptions) of the import definitions with these keys, as a Map key -> { name, description }. */
export async function fetchImportDefinitionNames(stack, keys, { retrieve } = {}) {
  const list = [...new Set(keys.filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < list.length; i += 2000) {
    const chunk = list.slice(i, i + 2000)
    const filter = chunk.length === 1 ? { property: 'CustomerKey', operator: 'equals', values: chunk } : { property: 'CustomerKey', operator: 'IN', values: chunk }
    const rows = await soapRetrieveAll(stack, 'ImportDefinition', IMPORT_DEF_PROPS, { filter, ...opts(retrieve) })
    for (const d of rows) out.set(d.CustomerKey, { name: d.Name || '', description: d.Description || '', id: d.ObjectID || '' })
  }
  return out
}

/**
 * Import runs that started in the last `days` days (or for one import definition `key`),
 * newest first, each with its definition's name. A failing name lookup leaves names empty.
 */
export async function fetchImportResults(stack, { days = 30, key = null, now = Date.now(), retrieve } = {}) {
  const since = { property: 'StartDate', operator: 'greaterThan', values: [daysAgoIso(days, now)], dates: true }
  const filter = key ? { logical: 'AND', left: { property: 'ImportDefinitionCustomerKey', operator: 'equals', values: [key] }, right: since } : since
  const rows = (await retrieveProps(stack, 'ImportResultsSummary', IMPORT_RESULT_PROPS, IMPORT_RESULT_CHECKED, { filter, ...opts(retrieve) })).map(importResultRow)
  const names = await fetchImportDefinitionNames(stack, rows.map((r) => r.key), { retrieve }).catch(() => new Map())
  return rows.map((r) => ({ ...r, name: names.get(r.key)?.name || '' })).sort((a, b) => String(b.start).localeCompare(String(a.start)))
}
