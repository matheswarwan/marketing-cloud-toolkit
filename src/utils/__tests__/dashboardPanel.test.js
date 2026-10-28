import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = readFileSync(join(process.cwd(), 'public/dashboardPanel.js'), 'utf8')
const SUMMARY = {
  at: Date.parse('2026-10-21T10:00:00Z'),
  businessUnit: 'Main BU',
  automations: { total: 120, failedLastRun: 2, attentionCount: 3, byStatus: [{ label: 'Scheduled', count: 80 }], attention: [{ id: 'a1', name: 'Nightly <b>load</b>', reason: 'Last run: Error' }] },
  journeys: { total: 40, live: 12, byStatus: [{ label: 'Published', count: 12 }] },
  watched: [{ type: 'journey', id: 'j1', name: 'Welcome', status: 'Published', lastRunStatus: '' }],
  errors: { automations: null, journeys: null },
}

const FRAME = '<div class="mc-app"><iframe id="dash" src="about:blank" style="display:block"></iframe></div>'

function page(url, { setting = true, html = FRAME } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url, runScripts: 'outside-only' })
  const sent = []
  const stored = {}
  dom.window.chrome = {
    runtime: { lastError: undefined, sendMessage: (m, cb) => { sent.push(m); setTimeout(() => cb(m.type === 'DASHBOARD_SUMMARY' ? { summary: SUMMARY } : { ok: true }), 0) } },
    storage: { local: {
      get: (k, cb) => cb(setting === null ? {} : { _dashboardPanel: setting }),
      set: (o) => Object.assign(stored, o),
    }, onChanged: { addListener() {} } },
  }
  dom.window.setInterval = () => 0
  dom.window.eval(SCRIPT)
  const doc = dom.window.document
  const host = () => doc.getElementById('sfmc-toolkit-dashboard-card')
  const iframe = () => doc.getElementById('dash')
  return { dom, sent, host, iframe, stored }
}
const tick = () => new Promise((r) => setTimeout(r, 10))
const DASH = 'https://mc.s13.exacttarget.com/cloud/#app/Marketing%20Cloud%20Dashboard/?ks=ks'
const button = (host, text) => [...host.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === text)

describe('Marketing Cloud Toolkit on the Marketing Cloud Dashboard (feedback #65)', () => {
  it('replaces the content of div.mc-app and renders the summary as text', async () => {
    const { sent, host, iframe } = page(DASH)
    expect(host().parentElement.className).toBe('mc-app')
    expect(iframe().style.display).toBe('none')
    await tick()
    expect(sent[0]).toEqual({ type: 'DASHBOARD_SUMMARY', stack: 's13', force: false })
    const root = host().shadowRoot
    const text = root.textContent
    expect(text).toContain('Trial')
    expect(text).toContain('120')
    expect(text).toContain('Last run: Error')
    expect(text).toContain('Welcome')
    expect(text).toContain('Main BU')
    expect(root.querySelector('b.load, .nm b')).toBeNull()
    root.querySelector('.item').click()
    await tick()
    expect(sent.at(-1)).toEqual({ type: 'OPEN_APP', path: '/automations/a1' })
  })

  it('picks the visible div.mc-app when SFMC has more than one', () => {
    const html = '<div class="mc-app" id="old" style="display:none"><iframe id="other"></iframe></div>' + FRAME
    const { host, iframe, dom } = page(DASH, { html })
    expect(host().parentElement.id).toBe('')
    expect(host().parentElement.className).toBe('mc-app')
    expect(iframe().style.display).toBe('none')
    expect(dom.window.document.getElementById('other').style.display).toBe('')
  })

  it('is off unless turned on, and stays away from other pages', () => {
    expect(page(DASH, { setting: null }).host()).toBeNull()
    expect(page(DASH, { setting: false }).host()).toBeNull()
    expect(page('https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/').host()).toBeNull()
    expect(page('https://evil.example.com/#app/Marketing%20Cloud%20Dashboard/').host()).toBeNull()
    expect(page(DASH, { html: '<div class="other"></div>' }).host()).toBeNull()
  })

  it('gives the dashboard back on Show SFMC dashboard and Turn off', () => {
    const a = page(DASH)
    button(a.host(), 'Show SFMC dashboard').click()
    expect(a.host()).toBeNull()
    expect(a.iframe().style.display).toBe('block')
    expect(a.iframe().hasAttribute('data-sfmc-toolkit-hidden')).toBe(false)
    const b = page(DASH)
    button(b.host(), 'Turn off').click()
    expect(b.stored._dashboardPanel).toBe(false)
    expect(b.host()).toBeNull()
    expect(b.iframe().style.display).toBe('block')
  })

  it('gives the frame back when SFMC moves to another app', () => {
    const { dom, host, iframe } = page(DASH)
    expect(host()).toBeTruthy()
    dom.reconfigure({ url: 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/' })
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'))
    expect(host()).toBeNull()
    expect(iframe().style.display).toBe('block')
  })
})

describe('dashboardSummary', () => {
  it('keeps names, counts and ids only, and the watches of this stack', async () => {
    vi.stubGlobal('chrome', { runtime: {}, storage: { local: {} } })
    const { dashboardSummary } = await import('../../background/dashboard.js')
    const s = dashboardSummary(
      [{ id: 'a1', name: 'A', status: 6, lastRunStatus: 'Error', lastRunTime: '2026-10-20T00:00:00Z' }, { id: 'a2', name: 'B', status: 6 }],
      [{ id: 'j1', status: 'Published' }, { id: 'j2', status: 'Draft' }],
      { 's13:a1': { stack: 's13', id: 'a1', name: 'A', last: { status: 4 } }, 's4:x': { stack: 's4', id: 'x' } },
      's13', Date.parse('2026-10-21T00:00:00Z'),
    )
    expect(s.automations).toMatchObject({ total: 2, failedLastRun: 1, attentionCount: 1 })
    expect(s.automations.attention[0]).toEqual({ id: 'a1', name: 'A', reason: 'Last run: Error' })
    expect(s.journeys).toMatchObject({ total: 2, live: 1 })
    expect(s.watched).toEqual([{ type: 'automation', id: 'a1', name: 'A', status: 'Paused', lastRunStatus: '' }])
    vi.unstubAllGlobals()
  })
})

describe('dashboard lists', () => {
  it('pages automations and journeys and keys the cache by business unit', async () => {
    vi.resetModules()
    const urls = []
    vi.doMock('../../background/fetchProxy.js', () => ({
      sfmcFetch: async ({ url }) => {
        urls.push(url)
        if (url.includes('accounts/@current')) return { name: 'BU', accountId: urls.filter((u) => u.includes('@current')).length }
        if (url.includes('automation/definition')) {
          const skip = Number(url.match(/\$skip=(\d+)/)[1])
          return { totalResults: 60, entry: Array.from({ length: Math.min(50, 60 - skip) }, (_, i) => ({ id: `a${skip + i}`, status: 6 })) }
        }
        if (url.includes('/interactions?')) return { count: 3, items: [{ id: 'j1', status: 'Published' }, { id: 'j2', status: 'Draft' }, { id: 'j3', status: 'Stopped' }] }
        return {}
      },
    }))
    vi.doMock('../../background/chromeAsync.js', () => ({ storageGet: async () => ({}) }))
    const { getDashboardSummary } = await import('../../background/dashboard.js')
    const s = await getDashboardSummary('s13')
    expect(s.automations.total).toBe(60)
    expect(s.journeys.total).toBe(3)
    expect(s.businessUnit).toBe('BU')
    // A different BU id (the stub counts calls) reads again instead of using the cache.
    const before = urls.filter((u) => u.includes('automation/definition')).length
    await getDashboardSummary('s13')
    expect(urls.filter((u) => u.includes('automation/definition')).length).toBeGreaterThan(before)
    await expect(getDashboardSummary('nope')).rejects.toThrow('No SFMC stack')
    vi.doUnmock('../../background/fetchProxy.js')
    vi.doUnmock('../../background/chromeAsync.js')
  })
})
