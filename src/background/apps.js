// Which SFMC host a URL belongs to, and how that host authenticates.
//
// - core: mc.<stack>.exacttarget.com and members.<stack>.exacttarget.com. Cookie
//   session; mutating calls send the core CSRF token when one has been captured.
// - mca: <app>.<stack>.marketingcloudapps.com. Each app keeps its own session.
//   Automation Studio / Contact Builder meta (mc.*) and Content Builder accept the
//   minted MCA Bearer token (from SFMC Query Saver). CloudPages and Journey Builder
//   are reached with their own session cookies (from SFMC Automation Viewer).
//
// Each mca app also lists landing pages: when the app has no session, one is opened
// in an inactive tab until the probe URL answers 200 (see sessions.js).

import { coreOrigin, stackFromCoreHost } from '../utils/sfmcHosts.js'

export const STACK_RE = /^s?\d+$/

// MM-DD-YYYY, the date format the storage history call takes.
const mdY = (t) => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}` }

// Session start settings shared by the Setup apps (live test, 2026-11-07): a quick
// landing gets 6 s (the SSO hop answers in about 1.5 s), the Setup page that embeds the
// app 15 s (the whole Marketing Cloud shell loads first). A failed start is not
// repeated within 10 s, so the page's automatic reconnect does not run it a second time.
const SETUP_SESSION = {
  landingTimeoutMs: (url) => (url.includes('/cloud/#app/Setup/') ? 15000 : 6000),
  retryGapMs: 10000,
}

const ssoLanding = (s, query) => `${coreOrigin(s)}/cloud/tools/SSO.aspx?${query}`

export const SFMC_APPS = [
  {
    id: 'automationStudio',
    name: 'Automation Studio',
    matches: (url) => url.hostname.startsWith('mc.') && url.pathname.startsWith('/AutomationStudioFuel3/'),
    bearer: true,
    probeUrl: (s) => `https://mc.${s}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations?$page=1&$pageSize=1`,
    landings: (s) => [
      `https://mc.${s}.marketingcloudapps.com/AutomationStudioFuel3/update-token.json`,
      `${coreOrigin(s)}/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`,
    ],
  },
  {
    id: 'contactsMeta',
    name: 'Data Extensions',
    matches: (url) => url.hostname.startsWith('mc.') && url.pathname.startsWith('/contactsmeta/'),
    bearer: true,
    probeUrl: (s) => `https://mc.${s}.marketingcloudapps.com/contactsmeta/fuelapi/legacy/v1/beta/folder`,
    landings: (s) => [
      `https://mc.${s}.marketingcloudapps.com/contactsmeta/`,
      `${coreOrigin(s)}/cloud/#app/Contact%20Builder`,
    ],
  },
  {
    // Contact Builder's newer data UI (data extension storage, feedback #68). Assumed
    // to take the MCA Bearer token like contactsmeta; not checked against a live org.
    // `onDemand`: left out of the connection status and the automatic warm-up (its
    // cookie probe may never pass); a session is started only when a call needs it.
    id: 'dataUi',
    onDemand: true,
    name: 'Data Extension storage',
    matches: (url) => url.hostname.startsWith('mc-data-ui.'),
    bearer: true,
    probeUrl: (s) => `https://mc-data-ui.${s}.marketingcloudapps.com/fuelapi/data/v1/customobjects/storageHistory?startDate=${mdY(Date.now() - 86400000)}&endDate=${mdY(Date.now())}`,
    landings: (s) => [`${coreOrigin(s)}/cloud/#app/Contact%20Builder`],
  },
  {
    id: 'contentBuilder',
    name: 'Content Builder',
    // Stays in the business unit of its last sign-in (checked live on s10, 2026-11-17): appBu.js.
    followsBusinessUnit: false,
    tokenContextUrl: (s) => `https://content-builder.${s}.marketingcloudapps.com/fuelapi/platform/v1/tokenContext`,
    matches: (url) => url.hostname.startsWith('content-builder.'),
    bearer: true,
    csrfCookie: '_csrf',
    probeUrl: (s) => `https://content-builder.${s}.marketingcloudapps.com/fuelapi/asset/v1/content/categories/?categoryType=cloudpages&$page=1&$pagesize=1`,
    landings: (s) => [
      ssoLanding(s, 'appId=dcb615e6-146e-4887-9e52-fff1f45c2b1e&hub=1'),
      `${coreOrigin(s)}/cloud/#app/Content%20Builder`,
    ],
    // Feedback #1099 (stack 401): the start timed out. The landing loads the whole
    // Marketing Cloud shell before Content Builder, so it gets timing.slowLandingMs (25 s).
    slowLanding: (url) => !url.includes('/cloud/tools/SSO.aspx'),
    sessionHint: 'Open Content Builder in Marketing Cloud once in this browser, then press Retry. If it does not open there either, your user may not have access to Content Builder in this business unit.',
  },
  {
    id: 'cloudPages',
    name: 'CloudPages',
    matches: (url) => url.hostname.startsWith('cloud-pages.'),
    bearer: false,
    probeUrl: (s) => `https://cloud-pages.${s}.marketingcloudapps.com/fuelapi/internal/v2/cloudpages/sites?$page=1&$pagesize=1`,
    landings: (s) => [
      `https://cloud-pages.${s}.marketingcloudapps.com/update-token.json`,
      `${coreOrigin(s)}/cloud/#app/CloudPages`,
    ],
  },
  {
    id: 'journeyBuilder',
    name: 'Journey Builder',
    // Stays in the business unit the user logged in to (checked live on s10, 2026-11-17): appBu.js.
    followsBusinessUnit: false,
    tokenContextUrl: (s) => `https://jbinteractions.${s}.marketingcloudapps.com/fuelapi/platform/v1/tokenContext`,
    matches: (url) => url.hostname.startsWith('jbinteractions.'),
    bearer: false,
    probeUrl: (s) => `https://jbinteractions.${s}.marketingcloudapps.com/fuelapi/interaction/v1/eventDefinitions?$page=1&$pagesize=1`,
    landings: (s) => [
      ssoLanding(s, 'appId=ce186f27-e854-454e-805e-ba78ba47bbfb&env=default&legacy=1&hub=1'),
      `${coreOrigin(s)}/cloud/#app/Journey%20Builder`,
    ],
  },
  // Setup's apps (Domains and Installed Packages pages, user, 2026-11-05). Checked live on
  // s10 (live test, 2026-11-07): each is a cookie session (no Bearer token), started the
  // way SFMC's Setup starts it: core SSO.aspx?appId=... auto-posts to the app's /login.
  // Neither the app's root (email-app: 401 "Please log in") nor #app/Setup (it only
  // starts mc-setup) creates one. Landings: the app's SSO hop (about 1.5 s), then the
  // Setup page that embeds the app (about 8 to 11 s), in case an app id differs.
  // On demand: started only when one of their calls needs a session. A failed start is
  // not repeated by the page's automatic reconnect right after it (see sessions.js).
  {
    id: 'emailApp',
    onDemand: true,
    name: 'Sender authentication (Setup)',
    matches: (url) => url.hostname.startsWith('email-app.'),
    bearer: false,
    probeUrl: (s) => `https://email-app.${s}.marketingcloudapps.com/fuelapi/messaging/v1/domainverification?$page=1&$pagesize=1`,
    landings: (s) => [
      `${coreOrigin(s)}/cloud/tools/SSO.aspx?appId=6df293a1-4fdc-41cd-aa08-89efc793c33c&env=default&legacy=1&deepLink=/%23/admin/domainverification`,
      `${coreOrigin(s)}/cloud/#app/Setup/FromAddressManagement`,
    ],
    ...SETUP_SESSION,
    sessionHint: 'Open Setup > Feature Settings > Email Studio > From Address Management in Marketing Cloud: if it does not load there either, your user cannot view sender authentication.',
  },
  {
    id: 'customDomains',
    onDemand: true,
    name: 'Custom domains (Setup)',
    matches: (url) => url.hostname.startsWith('custom-domains-ui.'),
    bearer: false,
    probeUrl: (s) => `https://custom-domains-ui.${s}.marketingcloudapps.com/fuelapi/internal/v1/ssl/customdomains/?$page=1&$pageSize=1`,
    // This app signs in from its own root (its /login does the hop; about 2.6 s live).
    landings: (s) => [`https://custom-domains-ui.${s}.marketingcloudapps.com/`, `${coreOrigin(s)}/cloud/#app/Setup/CustomDomains`],
    ...SETUP_SESSION,
    sessionHint: 'Open Setup > Security > Domain SSL Certificates in Marketing Cloud: if it does not load there either, your user cannot view custom domains.',
  },
  {
    id: 'domainAllowlist',
    onDemand: true,
    name: 'Account endpoints (Setup)',
    matches: (url) => url.hostname.startsWith('mc-domainwhitelist-admin-app.'),
    bearer: false,
    probeUrl: (s) => `https://mc-domainwhitelist-admin-app.${s}.marketingcloudapps.com/fuelapi/platform/v1/endpoints`,
    landings: (s) => [
      `${coreOrigin(s)}/cloud/tools/SSO.aspx?appId=FF14944B-7CDB-4FF1-82DB-40F022C2C2DC&restToken=1`,
      `${coreOrigin(s)}/cloud/#app/Setup/DomainWhitelist`,
    ],
    ...SETUP_SESSION,
    sessionHint: 'Open Setup > Security > Domain Allowlist in Marketing Cloud: if it does not load there either, your user cannot view the account endpoints.',
  },
]

export function findApp(appId) {
  return SFMC_APPS.find((a) => a.id === appId) || null
}

// { stack, family: 'core' | 'mca' | null, app } for an SFMC API URL.
export function resolveUrl(rawUrl) {
  let url
  try { url = new URL(rawUrl) } catch { return { stack: null, family: null, app: null } }
  const labels = url.hostname.split('.')
  const stack = labels.length >= 4 && STACK_RE.test(labels[1]) ? labels[1] : null
  const coreStack = stackFromCoreHost(url.hostname)
  if (coreStack) {
    return { stack: STACK_RE.test(coreStack) ? coreStack : null, family: 'core', app: null }
  }
  if (url.hostname.endsWith('.marketingcloudapps.com')) {
    return { stack, family: 'mca', app: SFMC_APPS.find((a) => a.matches(url)) || null }
  }
  return { stack: null, family: null, app: null }
}

// The stack of an open SFMC page, or null for login pages and non-SFMC URLs.
export function stackFromPageUrl(rawUrl) {
  if (!rawUrl || rawUrl.includes('/login') || rawUrl.includes('mc.login.')) return null
  const m = rawUrl.match(/^https:\/\/[a-z-]+\.([^.]+)\.(?:exacttarget|marketingcloudapps)\.com\//)
  return m && STACK_RE.test(m[1]) ? m[1] : null
}
