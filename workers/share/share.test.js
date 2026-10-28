import { describe, it, expect } from 'vitest'
import worker, { renderPage, newId, readShare, isExtensionOrigin, LIMITS } from './src/index.js'

const EXT = 'chrome-extension://bkajbggginfjnjhaiififajmncgdneli'
function fakeKv() {
  const store = new Map()
  return { store, put: async (k, v, o) => { store.set(k, { v, o }) }, get: async (k) => (store.has(k) ? JSON.parse(store.get(k).v) : null) }
}
const post = (body, origin = EXT) => new Request('https://s.example/api/share', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: origin ? { Origin: origin } : {} })

describe('share worker', () => {
  it('stores only name and SQL for 24 hours under a 22-character random id', async () => {
    const env = { SHARE_KV: fakeKv() }
    const res = await worker.fetch(post({ name: 'Q', queryText: 'SELECT 1', extra: 'x' }), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(EXT)
    const { url } = await res.json()
    const id = url.split('/share/')[1]
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const saved = env.SHARE_KV.store.get(id)
    expect(JSON.parse(saved.v)).toEqual({ name: 'Q', queryText: 'SELECT 1' })
    expect(saved.o).toEqual({ expirationTtl: 86400 })
  })
  it('refuses web page origins, empty SQL and oversized bodies', async () => {
    const env = { SHARE_KV: fakeKv() }
    expect((await worker.fetch(post({ queryText: 'SELECT 1' }, 'https://evil.example'), env)).status).toBe(403)
    expect((await worker.fetch(post({ queryText: ' ' }), env)).status).toBe(400)
    expect((await worker.fetch(post({ queryText: 'x'.repeat(LIMITS.queryText + 1) }), env)).status).toBe(413)
    expect((await worker.fetch(post('{"queryText":"' + 'x'.repeat(LIMITS.body) + '"}'), env)).status).toBe(413)
    expect(env.SHARE_KV.store.size).toBe(0)
  })
  it('accepts extension origins only', () => {
    expect(isExtensionOrigin(EXT)).toBe(true)
    expect(isExtensionOrigin('chrome-extension://abc')).toBe(false)
    expect(isExtensionOrigin('https://mc.s7.exacttarget.com')).toBe(false)
  })
  it('puts no data in a script and escapes it everywhere (the old page could be broken out of)', () => {
    const html = renderPage({ name: '"><img src=x onerror=alert(1)>', queryText: "SELECT '</script><script>alert(1)</script>' AS x" })
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).not.toContain('<img src=x')
    expect(html.match(/<script/g)).toEqual(['<script'])
    expect(html).toContain('<script src="/share.js"></script>')
    expect(html).toContain('data-query-text="SELECT &#39;&lt;/script&gt;')
  })
  it('serves the page with a strict CSP, noindex and no-store, and 404 for unknown or malformed ids', async () => {
    const env = { SHARE_KV: fakeKv() }
    await env.SHARE_KV.put('AbCdEfGhIjKlMnOpQrStUv', JSON.stringify({ name: 'Q', queryText: 'SELECT 1' }))
    const ok = await worker.fetch(new Request('https://s.example/share/AbCdEfGhIjKlMnOpQrStUv'), env)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(ok.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(ok.headers.get('Cache-Control')).toBe('no-store')
    expect((await worker.fetch(new Request('https://s.example/share/nope'), env)).status).toBe(404)
    expect((await worker.fetch(new Request('https://s.example/share/..%2Fx'), env)).status).toBe(404)
    expect((await worker.fetch(new Request('https://s.example/api/share/abc12345'), env)).status).toBe(404)
  })
  it('makes different ids', () => {
    expect(new Set(Array.from({ length: 50 }, newId)).size).toBe(50)
  })
  it('reads only name and queryText', async () => {
    const r = await readShare(new Request('https://s.example', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(300), queryText: 'SELECT 1' }) }))
    expect(r.value.name).toHaveLength(LIMITS.name)
  })
})
