import { describe, it, expect, vi, beforeEach } from 'vitest'

const tabs = []
vi.mock('../chromeAsync.js', () => ({
  storageGet: async () => ({}),
  storageSet: async () => {},
  createTab: async (p) => { const t = { id: tabs.length + 1, ...p }; tabs.push(t); return t },
  removeTab: () => {},
}))

const load = async () => { vi.resetModules(); return import('../pageHeaders.js') }
const req = (headers, extra = {}) => ({
  url: 'https://mc.s50.marketingcloudapps.com/contactsmeta/fuelapi/contacts/v1/addresses/count/',
  tabId: 7, initiator: 'https://mc.s50.marketingcloudapps.com',
  requestHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), ...extra,
})

describe('Contact Builder page headers', () => {
  beforeEach(() => { tabs.length = 0 })

  it('knows which calls need them', async () => {
    const m = await load()
    expect(m.needsPageHeaders('https://mc.s50.marketingcloudapps.com/contactsmeta/fuelapi/contacts-internal/v1/addresses/search/?a=1')).toBe(true)
    expect(m.needsPageHeaders('https://mc.s50.marketingcloudapps.com/contactsmeta/fuelapi/legacy/v1/beta/contact/abc/address/')).toBe(true)
    expect(m.needsPageHeaders('https://mc.s50.marketingcloudapps.com/contactsmeta/fuelapi/legacy/v1/beta/folder')).toBe(false)
  })

  it('reads them from the page, not from the extension', async () => {
    const m = await load()
    m.sniffPageHeaders(req({ authorization: 'Bearer ext' }, { tabId: -1 }))
    m.sniffPageHeaders(req({ authorization: 'Bearer ext' }, { initiator: 'chrome-extension://abc' }))
    expect(m.pageHeadersFor('s50')).toBe(null)
    m.sniffPageHeaders(req({ authorization: 'Bearer 1', 'X-CSRF-Token': 'c1', tz: 'accountPreference' }))
    m.sniffPageHeaders(req({ authorization: 'Bearer 2' })) // a GET without CSRF keeps the last token
    expect(m.pageHeadersFor('s50')).toEqual({ 'X-Requested-With': 'XMLHttpRequest', Authorization: 'Bearer 2', 'X-CSRF-Token': 'c1', tz: 'accountPreference' })
    m.dropPageHeaders('s50')
    expect(m.pageHeadersFor('s50')).toBe(null)
  })

  it('opens Contact Builder in an inactive tab to read them when none are known', async () => {
    const m = await load()
    m.pageTiming.pollMs = 5
    m.pageTiming.waitMs = 500
    const p = m.capturePageHeaders('s50')
    setTimeout(() => m.sniffPageHeaders(req({ authorization: 'Bearer 3', 'x-csrf-token': 'c3' })), 20)
    const h = await p
    expect(h).toMatchObject({ Authorization: 'Bearer 3', 'X-CSRF-Token': 'c3' })
    expect(tabs[0]).toMatchObject({ active: false, url: 'https://mc.s50.marketingcloudapps.com/contactsmeta/admin.html#admin/all-contacts' })
  })
})
