// Share service for Marketing Cloud Toolkit (moved from the archived SFMC Query Saver
// repo, security review 2026-10-28). POST /api/share stores a query's name and SQL in
// KV for 24 hours under a random 128-bit id; GET /share/<id> shows it. The extension
// (public/share-handler.js) offers to import it from that page.
//
// Hardening: random ids (22 characters, not 8 hex), size limits, no inline script and
// no JSON in a <script> (the old page could be broken out of with "</script>" in the
// SQL), a strict CSP, noindex, no-store, no referrer, and POST only from extension
// pages when the browser sends an Origin. Nothing about the sender is stored.

const TTL_SECONDS = 24 * 60 * 60
export const LIMITS = { body: 120_000, name: 200, queryText: 100_000 }
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/ // 8 hex (old links, gone within a day) or 22 base64url

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const origin = request.headers.get('Origin')

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })

    if (request.method === 'POST' && path === '/api/share') {
      // Browsers send an Origin: only the extension's pages may create links.
      if (origin && !isExtensionOrigin(origin)) return json({ error: 'Not allowed' }, 403, origin)
      const parsed = await readShare(request)
      if (parsed.error) return json({ error: parsed.error }, parsed.status || 400, origin)
      const id = newId()
      await env.SHARE_KV.put(id, JSON.stringify(parsed.value), { expirationTtl: TTL_SECONDS })
      return json({ url: `https://${url.host}/share/${id}` }, 200, origin)
    }

    if (request.method === 'GET' && path === '/share.js') {
      return new Response(PAGE_SCRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } })
    }

    if (request.method === 'GET' && path.startsWith('/share/')) {
      const id = path.slice('/share/'.length)
      const data = ID_RE.test(id) ? await env.SHARE_KV.get(id, 'json') : null
      return new Response(renderPage(data), { status: data ? 200 : 404, headers: PAGE_HEADERS })
    }

    return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } })
  },
}

export const isExtensionOrigin = (origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(String(origin || ''))

function corsHeaders(origin) {
  if (!isExtensionOrigin(origin)) return { 'Vary': 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

/** The share to store, or { error, status }. Only `name` and `queryText` are kept. */
export async function readShare(request) {
  const text = await request.text()
  if (text.length > LIMITS.body) return { error: 'Too large', status: 413 }
  let body
  try { body = JSON.parse(text) } catch { return { error: 'Invalid JSON' } }
  const queryText = typeof body?.queryText === 'string' ? body.queryText : ''
  if (!queryText.trim()) return { error: 'queryText is required' }
  if (queryText.length > LIMITS.queryText) return { error: 'queryText is too long', status: 413 }
  const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, LIMITS.name) || 'Untitled Query'
  return { value: { name, queryText } }
}

/** 128 random bits as 22 base64url characters. */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Copy button and the "install the extension" note; no data in it.
const PAGE_SCRIPT = `document.getElementById('copy-btn')?.addEventListener('click', function () {
  var btn = this
  navigator.clipboard.writeText(document.getElementById('sql-block').innerText).then(function () {
    btn.textContent = 'Copied'
    setTimeout(function () { btn.textContent = 'Copy' }, 2000)
  })
})
setTimeout(function () {
  var bar = document.getElementById('sfmc-status')
  if (bar && bar.className === 'status-bar') {
    bar.className = 'status-bar no-ext'
    document.getElementById('sfmc-status-text').textContent = 'Install Marketing Cloud Toolkit to import this query into Saved queries.'
  }
}, 2000)
`

const STYLE = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 40px 20px; }
    .container { max-width: 860px; margin: 0 auto; }
    .header { margin-bottom: 24px; }
    .badge { display: inline-block; font-size: 11px; font-weight: 600; color: #60a5fa; background: rgba(0,112,210,.15); border: 1px solid rgba(0,112,210,.3); border-radius: 99px; padding: 3px 10px; margin-bottom: 12px; letter-spacing: .5px; text-transform: uppercase; }
    h1 { font-size: 1.4rem; font-weight: 700; color: #f1f5f9; margin-bottom: 6px; overflow-wrap: anywhere; }
    .meta { font-size: 12px; color: #64748b; }
    .status-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; padding: 12px 16px; border-radius: 10px; background: rgba(0,112,210,.1); border: 1px solid rgba(0,112,210,.25); font-size: 13px; color: #93c5fd; }
    .status-bar.imported { background: rgba(22,163,74,.1); border-color: rgba(22,163,74,.25); color: #86efac; }
    .status-bar.no-ext { background: rgba(251,191,36,.07); border-color: rgba(251,191,36,.2); color: #fcd34d; }
    .code-wrap { border-radius: 12px; overflow: hidden; border: 1px solid #1e293b; }
    .code-header { background: #1e293b; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; }
    .code-label { font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; }
    .copy-btn { font-size: 12px; padding: 4px 12px; background: #334155; color: #94a3b8; border: none; border-radius: 6px; cursor: pointer; }
    .copy-btn:hover { background: #475569; color: #e2e8f0; }
    pre { background: #020617; padding: 24px; overflow-x: auto; font-family: ui-monospace, 'JetBrains Mono', 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #cbd5e1; white-space: pre-wrap; word-break: break-word; }`

export function renderPage(data) {
  if (!data) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Link expired · Marketing Cloud Toolkit</title>
  <style>body { font-family: system-ui, sans-serif; background: #0f172a; color: #94a3b8; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; } h1 { color: #f87171; font-size: 1.5rem; text-align: center; } p { text-align: center; }</style>
</head>
<body><div><h1>Link expired or not found</h1><p>Shared queries are kept for 24 hours.</p></div></body>
</html>`
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(data.name)} · Marketing Cloud Toolkit</title>
  <style>
    ${STYLE}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Marketing Cloud Toolkit</div>
      <h1>${escapeHtml(data.name)}</h1>
      <div class="meta">Shared SQL. This link expires 24 hours after it was created.</div>
    </div>
    <div id="sfmc-status" class="status-bar">
      <span id="sfmc-status-text">Checking for Marketing Cloud Toolkit…</span>
    </div>
    <div class="code-wrap">
      <div class="code-header">
        <span class="code-label">SQL</span>
        <button id="copy-btn" class="copy-btn" type="button">Copy</button>
      </div>
      <pre id="sql-block">${escapeHtml(data.queryText)}</pre>
    </div>
  </div>
  <div id="sfmc-qs-meta" hidden data-name="${escapeHtml(data.name)}" data-query-text="${escapeHtml(data.queryText)}"></div>
  <script src="/share.js"></script>
</body>
</html>`
}
