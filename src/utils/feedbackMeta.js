// Technical details sent with feedback only when the user ticks "Include technical
// details" (off by default; never offered under the disableFeedbackMetadata policy).
// Security review, 2026-10-28: nothing that names the customer's account or data: no
// business unit or MID, no SQL or results, no data extension or other record names,
// no SFMC URLs or paths, no error text from SFMC (it can name records). Failed calls
// are reduced to their HTTP status and the API area ("automation", "asset", ...).

/** A route with record ids taken out: /automations/1a2b-... -> /automations/:id. */
export function routePattern(route) {
  return String(route || '')
    .split(/[?#]/)[0]
    .split('/')
    .map((s, i) => (i > 1 && s && (/[\d_.%]/.test(s) || s.length > 24) ? ':id' : s))
    .join('/')
}

/** "automation", "asset", "data", ... from an SFMC API path; never the path itself. */
export function apiArea(path) {
  const m = String(path || '').match(/fuelapi\/(?:[a-z-]*internal\/)?(?:v\d\/)?([a-z][a-z-]*)/i) || String(path || '').match(/\/([a-z][a-z-]*)\/v\d/i)
  return m ? m[1].toLowerCase() : 'other'
}

export function collectFeedbackMetadata({ route, stack, theme, apiErrors = [], now = new Date() } = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const win = typeof window !== 'undefined' ? window : {}
  let version = 'unknown'
  try { version = chrome.runtime.getManifest().version } catch { /* not in an extension */ }
  return {
    appVersion: version,
    section: routePattern(route) || null,
    stack: stack || null,
    theme: theme || null,
    browser: nav.userAgent || null,
    language: nav.language || null,
    window: win.innerWidth ? `${win.innerWidth}x${win.innerHeight}` : null,
    time: now.toISOString(),
    recentErrors: apiErrors.slice(0, 5).map((e) => ({ area: apiArea(e.path), status: e.status ?? null })),
  }
}

/** The details as "label: value" lines for the preview in the form. */
export function metadataLines(meta) {
  const lines = []
  for (const [k, v] of Object.entries(meta || {})) {
    if (k === 'recentErrors') {
      lines.push(['Recent errors', v?.length ? v.map((e) => `${e.area} ${e.status ?? '(no status)'}`).join(', ') : 'none'])
    } else if (v != null && v !== '') {
      lines.push([k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), String(v)])
    }
  }
  return lines
}
