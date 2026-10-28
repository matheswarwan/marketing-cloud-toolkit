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

export const STACK_RE = /^s?\d+$/

// MM-DD-YYYY, the date format the storage history call takes.
const mdY = (t) => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}` }

export const SFMC_APPS = [
  {
    id: 'automationStudio',
    name: 'Automation Studio',
    matches: (url) => url.hostname.startsWith('mc.') && url.pathname.startsWith('/AutomationStudioFuel3/'),
    bearer: true,
    probeUrl: (s) => `https://mc.${s}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations?$page=1&$pageSize=1`,
    landings: (s) => [
      `https://mc.${s}.marketingcloudapps.com/AutomationStudioFuel3/update-token.json`,
      `https://mc.${s}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`,
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
      `https://mc.${s}.exacttarget.com/cloud/#app/Contact%20Builder`,
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
    landings: (s) => [`https://mc.${s}.exacttarget.com/cloud/#app/Contact%20Builder`],
  },
  {
    id: 'contentBuilder',
    name: 'Content Builder',
    matches: (url) => url.hostname.startsWith('content-builder.'),
    bearer: true,
    csrfCookie: '_csrf',
    probeUrl: (s) => `https://content-builder.${s}.marketingcloudapps.com/fuelapi/asset/v1/content/categories/?categoryType=cloudpages&$page=1&$pagesize=1`,
    landings: (s) => [`https://mc.${s}.exacttarget.com/cloud/#app/Content%20Builder`],
  },
  {
    id: 'cloudPages',
    name: 'CloudPages',
    matches: (url) => url.hostname.startsWith('cloud-pages.'),
    bearer: false,
    probeUrl: (s) => `https://cloud-pages.${s}.marketingcloudapps.com/fuelapi/internal/v2/cloudpages/sites?$page=1&$pagesize=1`,
    landings: (s) => [
      `https://cloud-pages.${s}.marketingcloudapps.com/update-token.json`,
      `https://mc.${s}.exacttarget.com/cloud/#app/CloudPages`,
    ],
  },
  {
    id: 'journeyBuilder',
    name: 'Journey Builder',
    matches: (url) => url.hostname.startsWith('jbinteractions.'),
    bearer: false,
    probeUrl: (s) => `https://jbinteractions.${s}.marketingcloudapps.com/fuelapi/interaction/v1/eventDefinitions?$page=1&$pagesize=1`,
    landings: (s) => [`https://mc.${s}.exacttarget.com/cloud/#app/Journey%20Builder`],
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
  if (/^(?:mc|members)\.[^.]+\.exacttarget\.com$/.test(url.hostname)) {
    return { stack, family: 'core', app: null }
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
