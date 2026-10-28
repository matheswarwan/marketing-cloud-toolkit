import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake service worker: handler(url) returns data, or an Error for a failed call.
function stub(handler) {
  const calls = []
  vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
    calls.push(msg.url)
    Promise.resolve(handler(msg.url, msg)).then((data) => cb(data instanceof Error ? { error: data.message, status: 500 } : { data }))
  } } })
  return calls
}

const de = (n, extra = {}) => ({ id: `de${n}`, name: `DE ${n}`, customerKey: `k${n}`, categoryId: n % 2, modifiedDate: '2026-10-01', ...extra })

describe('DE storage (feedback #68)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('lists every local page and adds Shared DEs once', async () => {
    stub((url) => {
      if (url.includes('customobjects/category/0')) {
        const page = Number(url.match(/\$page=(\d+)/)[1])
        const items = page === 1 ? Array.from({ length: 50 }, (_, i) => de(i)) : [de(50), de(51)]
        return { count: 52, items }
      }
      return {}
    })
    vi.doMock('../sfmcApi.js', async (orig) => ({ ...(await orig()), searchSharedDEs: async () => [{ id: 'de1', name: 'DE 1', sourceType: 'shared' }, { id: 'sh1', name: 'Shared 1', sourceType: 'shared' }] }))
    const { listAllDEs } = await import('../deStorage.js')
    const r = await listAllDEs('s4')
    expect(r.items).toHaveLength(53)
    expect(r.items.at(-1)).toMatchObject({ id: 'sh1', sourceType: 'shared' })
    expect(r.capped).toBe(false)
    vi.doUnmock('../sfmcApi.js')
  })

  it('reads row counts, keeps counts from the list and reports errors', async () => {
    stub((url) => (url.includes('/de2') ? new Error('SFMC API error 500: nope') : { totalRowCount: 7 }))
    const { readRowCounts } = await import('../deStorage.js')
    const got = {}
    const errors = await readRowCounts('s4', [de(1), de(2), de(3, { rowCount: 99 })], { onRow: (d, n, e) => { got[d.id] = e ? 'error' : n } })
    expect(got).toEqual({ de1: 7, de2: 'error', de3: 99 })
    expect(errors).toBe(1)
  })

  it('sorts, sums, groups by folder and writes CSV', async () => {
    const { sortBySize, summarizeStorage, groupByFolder, storageCsv } = await import('../deStorage.js')
    const rows = [
      { ...de(1), rows: 10 }, { ...de(2), rows: 500, sourceType: 'shared' }, { ...de(3), rows: 0 }, { ...de(4), rows: null, name: 'A' },
    ]
    expect(sortBySize(rows).map((r) => r.id)).toEqual(['de2', 'de1', 'de3', 'de4'])
    const s = summarizeStorage(rows)
    expect(s).toMatchObject({ des: 4, counted: 3, totalRows: 510, empty: 1 })
    expect(s.largest.id).toBe('de2')
    expect(s.bySource.map((x) => x.label)).toEqual(['Shared', 'Local'])
    const g = groupByFolder(rows, { 0: 'Data Extensions > Even', 1: 'Data Extensions > Odd' })
    expect(g[0]).toMatchObject({ path: 'Data Extensions > Even', des: 2, rows: 500 })
    const csv = storageCsv(rows, { 0: 'Even' }).split('\r\n')
    expect(csv[0]).toContain('"Rows"')
    expect(csv[1]).toContain('"DE 2"')
    expect(csv[1]).toContain('"Shared"')
    expect(csv[1]).toContain('"Even"')
  })
})
