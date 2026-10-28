import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSharedDECatalog } from '../sharedDEs.js'

// Shared Items (10) > Regional (11) > EU (12), Synchronized (20), and the
// local Data Extensions root (1) and Recycle Bin (30), which must be ignored.
function fakeApi({ failChildrenOf, failDEsOf } = {}) {
  const children = { 10: [{ id: 11 }], 11: [{ id: 12 }], 12: [], 20: [] }
  const des = {
    10: [{ id: 'a', name: 'Shared_Customers', modifiedDate: '2026-01-01' }],
    12: [{ id: 'b', name: 'EU_Customers', modifiedDate: '2026-03-01' }, { id: 'c', name: 'EU_Orders', modifiedDate: '2026-02-01' }],
    20: [{ id: 'd', name: 'Contact_Salesforce', modifiedDate: '2026-04-01' }],
  }
  return {
    listRoots: vi.fn(async () => ({ entry: [
      { id: '1', type: 'dataextension', parentId: '0' },
      { id: '10', type: 'shared_data', parentId: '0' },
      { id: '20', type: 'synchronizeddataextension', parentId: '0' },
      { id: '30', type: 'recyclebin', parentId: '0' },
    ] })),
    listChildren: vi.fn(async (stack, id) => {
      if (id === String(failChildrenOf)) throw new Error('children failed')
      return { entry: children[id] || [] }
    }),
    listDEs: vi.fn(async (stack, id) => {
      if (id === String(failDEsOf)) throw new Error('DEs failed')
      return des[id] || []
    }),
  }
}

describe('createSharedDECatalog', () => {
  it('finds DEs in the Shared root and nested folders, newest first', async () => {
    const api = fakeApi()
    const results = await createSharedDECatalog(api).search('s10', 'customers')
    expect(results.map(d => d.id)).toEqual(['b', 'a'])
    expect(results.every(d => d.sourceType === 'shared')).toBe(true)
  })

  it('tags Synchronized DEs and skips the local root and recycle bin', async () => {
    const api = fakeApi()
    const all = await createSharedDECatalog(api).search('s10', '')
    expect(all.map(d => d.id)).toEqual(['d', 'b', 'c', 'a'])
    expect(all.find(d => d.id === 'd').sourceType).toBe('sync')
    const visited = [...api.listChildren.mock.calls, ...api.listDEs.mock.calls].map(c => c[1])
    expect(visited).not.toContain('1')
    expect(visited).not.toContain('30')
  })

  it('find matches the exact name, case-insensitively', async () => {
    const catalog = createSharedDECatalog(fakeApi())
    expect((await catalog.find('s10', 'eu_orders')).id).toBe('c')
    expect(await catalog.find('s10', 'EU_Order')).toBeNull()
  })

  it('loads the folders once per stack until the TTL or clear()', async () => {
    let t = 0
    const api = fakeApi()
    const catalog = createSharedDECatalog({ ...api, now: () => t })
    await catalog.search('s10', 'a')
    await catalog.find('s10', 'b')
    expect(api.listRoots).toHaveBeenCalledTimes(1)
    await catalog.search('s7', 'a')
    expect(api.listRoots).toHaveBeenCalledTimes(2)
    t = 11 * 60 * 1000
    await catalog.search('s10', 'a')
    expect(api.listRoots).toHaveBeenCalledTimes(3)
    catalog.clear('s10')
    await catalog.search('s10', 'a')
    expect(api.listRoots).toHaveBeenCalledTimes(4)
  })

  it('skips a folder that fails and keeps the rest', async () => {
    const catalog = createSharedDECatalog(fakeApi({ failChildrenOf: 11, failDEsOf: 20 }))
    expect((await catalog.search('s10', '')).map(d => d.id)).toEqual(['a'])
  })

  it('a failed root lookup is not cached', async () => {
    const api = fakeApi()
    api.listRoots.mockRejectedValueOnce(new Error('offline'))
    const catalog = createSharedDECatalog(api)
    await expect(catalog.search('s10', 'a')).rejects.toThrow('offline')
    expect((await catalog.search('s10', 'eu')).length).toBe(2)
  })

  it('lists a DE found in two folders once', async () => {
    const api = fakeApi()
    api.listDEs.mockImplementation(async () => [{ id: 'same', name: 'Dup' }])
    expect(await createSharedDECatalog(api).search('s10', 'dup')).toHaveLength(1)
  })
})

describe('fetchDEMetadata and searchDEsAllSources (sfmcApi.js)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  // Fake service worker: category/0 knows only LocalDE; Shared Items holds SharedDE.
  function stubChrome({ rootsFail = false } = {}) {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      const url = msg.url
      let result
      if (/\/folder\?\$where=/.test(url)) {
        if (rootsFail) return cb({ error: 'Network error' })
        result = { entry: [{ id: '10', type: 'shared_data', parentId: '0' }] }
      } else if (/\/children/.test(url)) result = { entry: [] }
      else if (/category\/0\?/.test(url)) {
        const all = [{ id: 'L', name: 'LocalDE' }, { id: 'S', name: 'SharedDE' }]
        const q = decodeURIComponent(url.match(/name=([^&]*)/)[1]).replace(/%/g, '').toLowerCase()
        result = { count: 1, items: all.filter(d => d.id === 'L' && d.name.toLowerCase().includes(q)) }
      } else if (/category\/10\?/.test(url)) result = { count: 1, items: [{ id: 'S', name: 'SharedDE', fieldCount: 3 }] }
      else result = {}
      cb({ data: result })
    } } })
  }

  it('falls back to Shared Items when the local search finds nothing', async () => {
    stubChrome()
    const { fetchDEMetadata } = await import('../sfmcApi.js')
    expect(await fetchDEMetadata('s10', 'shareddE')).toEqual({ id: 'S', name: 'SharedDE', fieldCount: 3 })
    await expect(fetchDEMetadata('s10', 'NoSuchDE')).rejects.toThrow(/^DE not found/)
  })

  it('does not report "DE not found" when the shared lookup itself fails', async () => {
    stubChrome({ rootsFail: true })
    const { fetchDEMetadata } = await import('../sfmcApi.js')
    await expect(fetchDEMetadata('s10', 'NoSuchDE')).rejects.toThrow('Network error')
  })

  it('tries Contact Builder and $search when the core name search finds nothing (feedback #89)', async () => {
    const urls = []
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      urls.push(msg.url)
      if (/\/folder\?\$where=/.test(msg.url)) return cb({ data: { entry: [] } })
      if (msg.url.includes('exacttarget.com')) return cb({ data: { items: [] } })
      if (msg.url.includes('name=')) return cb({ data: { items: [{ id: 'X', name: 'Other' }] } })
      if (msg.url.includes('$search=master_subscribers')) return cb({ data: { items: [{ id: 'N', name: 'Master_Subscribers' }] } })
      cb({ data: {} })
    } } })
    const { searchDEsAllSources } = await import('../sfmcApi.js')
    const { items } = await searchDEsAllSources('s10', 'master_subscribers')
    expect(items.map((d) => d.name)).toEqual(['Master_Subscribers'])
    expect(urls.filter((u) => u.includes('category/0')).length).toBe(3)
  })

  it('reports an error instead of no matches when every search fails', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      if (/\/folder\?\$where=/.test(msg.url)) return cb({ data: { entry: [] } })
      cb({ error: 'SFMC API error 500: boom' })
    } } })
    const { searchDEsAllSources } = await import('../sfmcApi.js')
    await expect(searchDEsAllSources('s10', 'x')).rejects.toThrow('boom')
  })

  it('searchDEsAllSources lists shared matches first, tagged', async () => {
    stubChrome()
    const { searchDEsAllSources } = await import('../sfmcApi.js')
    const { items } = await searchDEsAllSources('s10', 'de')
    expect(items.map(d => [d.name, d.sourceType])).toEqual([['SharedDE', 'shared'], ['LocalDE', undefined]])
  })
})
