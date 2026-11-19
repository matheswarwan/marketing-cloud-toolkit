import { describe, it, expect, vi } from 'vitest'
import { rowsFrom, columnsFor, fetchRowsAt, loadRemainingRows, filterRows, reloadRows, fetchLastRows, rowsReader, byIdPages } from '../deRows.js'

// A fake rowset of `n` rows: SFMC sends lower-cased names, keys and values apart.
function fakeRowset(n) {
  const calls = []
  const fetchPage = async (stack, key, page, size) => {
    calls.push({ stack, key, page, size })
    const start = (page - 1) * size
    const items = Array.from({ length: Math.max(0, Math.min(size, n - start)) }, (_, i) => ({ keys: { subscriberkey: `k${start + i}` }, values: { emailaddress: `e${start + i}@x.co` } }))
    return { count: n, page, pageSize: size, items }
  }
  return { calls, fetchPage }
}

describe('DE rows (feedback #117)', () => {
  it('puts the field names back and keeps keys and values together', () => {
    const rows = rowsFrom([{ keys: { subscriberkey: 'a' }, values: { emailaddress: 'a@x.co', extra: 1 } }], ['SubscriberKey', 'EmailAddress'])
    expect(rows).toEqual([{ SubscriberKey: 'a', EmailAddress: 'a@x.co', extra: 1 }])
    expect(columnsFor(['SubscriberKey', 'EmailAddress'], rows)).toEqual(['SubscriberKey', 'EmailAddress', 'extra'])
    expect(columnsFor([], rows)).toEqual(['SubscriberKey', 'EmailAddress', 'extra'])
  })

  it('reads a page at any offset, skipping into the SFMC page', async () => {
    const { calls, fetchPage } = fakeRowset(120)
    const first = await fetchRowsAt('s13', 'K', 0, 50, ['SubscriberKey'], fetchPage)
    expect(first.rows).toHaveLength(50)
    expect(first.total).toBe(120)
    expect(first.last).toBe(false)
    const third = await fetchRowsAt('s13', 'K', 100, 50, [], fetchPage)
    expect(third.rows.map((r) => r.subscriberkey)).toEqual(Array.from({ length: 20 }, (_, i) => `k${100 + i}`))
    expect(third.last).toBe(true)
    const off = await fetchRowsAt('s13', 'K', 50, 2500, [], fetchPage)
    expect(calls.at(-1)).toMatchObject({ page: 1, size: 2500, key: 'K' })
    expect(off.rows[0].subscriberkey).toBe('k50')
    expect(off.rows).toHaveLength(70)
  })

  it('loads all after the rows already there, up to the limit', async () => {
    const { fetchPage } = fakeRowset(6000)
    const got = []
    const added = await loadRemainingRows({ stack: 's13', key: 'K', have: 50, limit: 5000, onRows: (r) => got.push(...r), fetchPage })
    expect(added).toBe(4950)
    expect(got[0].subscriberkey).toBe('k50')
    expect(got.at(-1).subscriberkey).toBe('k4999')
  })

  it('stops between pages when asked, and at the end of the data', async () => {
    const { calls, fetchPage } = fakeRowset(10000)
    let pages = 0
    await loadRemainingRows({ stack: 's13', key: 'K', have: 0, onRows: () => { pages++ }, shouldStop: () => pages >= 2, fetchPage })
    expect(calls).toHaveLength(2)
    const small = fakeRowset(30)
    const got = []
    await loadRemainingRows({ stack: 's13', key: 'K', have: 0, onRows: (r) => got.push(...r), fetchPage: small.fetchPage })
    expect(got).toHaveLength(30)
    expect(small.calls).toHaveLength(1)
  })

  it('filters the loaded rows on the shown columns', () => {
    const rows = [{ a: 'Alpha', b: 1 }, { a: 'beta', b: 22 }, { a: null, b: 3 }]
    expect(filterRows(rows, ['a', 'b'], 'ALP')).toEqual([rows[0]])
    expect(filterRows(rows, ['b'], '2')).toEqual([rows[1]])
    expect(filterRows(rows, ['a'], '')).toBe(rows)
  })
})

describe('Refresh (feedback #139)', () => {
  it('reads as many rows as were loaded, from the start', async () => {
    const all = Array.from({ length: 120 }, (_, i) => ({ keys: { id: String(i) }, values: { n: String(i) } }))
    const fetchPage = async (s, k, page, size) => ({ items: all.slice((page - 1) * size, page * size), count: all.length })
    const r = await reloadRows({ stack: 's13', key: 'K', want: 100, fetchPage })
    expect(r.rows).toHaveLength(100)
    expect(r.total).toBe(120)
    expect(r.done).toBe(false)
    const one = await reloadRows({ stack: 's13', key: 'K', want: 10, fetchPage })
    expect(one.rows).toHaveLength(50)
  })
})

describe('Load last N rows (feedback #1097)', () => {
  // A fake rowset of `count` rows numbered 0..count-1, paged like SFMC ($page from 1).
  const fakeDE = (count, calls = []) => async (_stack, _key, page, size) => {
    calls.push({ page, size })
    const start = (page - 1) * size
    const items = []
    for (let i = start; i < Math.min(count, start + size); i++) items.push({ keys: { id: String(i) }, values: {} })
    return { count, items }
  }

  it('reads the count, then only the last rows', async () => {
    const calls = []
    const r = await fetchLastRows({ stack: 's1', key: 'K', n: 10, fetchPage: fakeDE(500, calls) })
    expect(r.total).toBe(500)
    expect(r.from).toBe(490)
    expect(r.rows.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, i) => String(490 + i)))
    expect(calls[0]).toEqual({ page: 1, size: 1 })
  })

  it('uses a known total without asking again and crosses page boundaries', async () => {
    const calls = []
    const r = await fetchLastRows({ stack: 's1', key: 'K', n: 3000, total: 6000, fetchPage: fakeDE(6000, calls) })
    expect(calls[0].size).not.toBe(1)
    expect(r.from).toBe(3000)
    expect(r.rows).toHaveLength(3000)
    expect(r.rows[0].id).toBe('3000')
    expect(r.rows.at(-1).id).toBe('5999')
  })

  it('gives every row when N is more than the data extension has', async () => {
    const r = await fetchLastRows({ stack: 's1', key: 'K', n: 100, fetchPage: fakeDE(7) })
    expect(r.from).toBe(0)
    expect(r.rows).toHaveLength(7)
  })

  it('returns nothing for an empty data extension', async () => {
    const r = await fetchLastRows({ stack: 's1', key: 'K', n: 5, fetchPage: fakeDE(0) })
    expect(r.rows).toEqual([])
    expect(r.total).toBe(0)
  })

  it('fails clearly when SFMC gives no count', async () => {
    const noCount = async () => ({ items: [{ keys: { id: '0' } }] })
    await expect(fetchLastRows({ stack: 's1', key: 'K', n: 5, fetchPage: noCount })).rejects.toThrow(/how many rows/)
  })
})

// Feedback #1120: Synchronized DEs read through Contact Builder by ID.

describe('rowsFrom with flat items (Contact Builder internal call)', () => {
  it('maps flat objects with the field names put back', () => {
    expect(rowsFrom([{ status__c: 'Open', id: 'a1' }], ['Status__c', 'Id'])).toEqual([{ Status__c: 'Open', Id: 'a1' }])
  })
})

describe('byIdPages', () => {
  it('returns the page as is when SFMC serves the size asked for', async () => {
    const f = vi.fn(async () => ({ count: 3, pageSize: 50, items: [{ a: 1 }] }))
    const d = await byIdPages('de-1', f)('s50', 'KEY', 1, 50)
    expect(d.items).toEqual([{ a: 1 }])
    expect(f).toHaveBeenCalledWith('s50', 'de-1', 1, 50)
  })
  it('reads several smaller pages when SFMC caps the page size', async () => {
    const all = Array.from({ length: 120 }, (_, i) => ({ n: i }))
    const f = vi.fn(async (_s, _id, page, size) => {
      const cap = Math.min(size, 25)
      return { count: 120, pageSize: cap, items: all.slice((page - 1) * cap, page * cap) }
    })
    const read = byIdPages('de-1', f)
    const d = await read('s50', 'KEY', 2, 50) // rows 50..99
    expect(d.items.map((r) => r.n)).toEqual(all.slice(50, 100).map((r) => r.n))
    expect(d.count).toBe(120)
    f.mockClear()
    const last = await read('s50', 'KEY', 3, 50) // rows 100..119; cap remembered, no probe
    expect(last.items.map((r) => r.n)).toEqual(all.slice(100).map((r) => r.n))
    expect(f.mock.calls.every((c) => c[3] === 25)).toBe(true)
  })
})

describe('rowsReader', () => {
  const ok = (tag) => vi.fn(async () => ({ count: 1, pageSize: 50, items: [{ tag }] }))
  const bad = () => vi.fn(async () => { throw Object.assign(new Error('400'), { status: 400 }) })

  it('reads a Synchronized DE by ID first', async () => {
    const byKey = ok('key'); const fetchById = ok('id')
    const d = await rowsReader({ id: 'x', sourceType: 'sync' }, { byKey, fetchById })('s50', 'K', 1, 50)
    expect(d.items[0].tag).toBe('id')
    expect(byKey).not.toHaveBeenCalled()
  })
  it('accepts the synchronized spelling too', async () => {
    const fetchById = ok('id')
    await rowsReader({ id: 'x', sourceType: 'synchronized' }, { byKey: ok('key'), fetchById })('s50', 'K', 1, 50)
    expect(fetchById).toHaveBeenCalled()
  })
  it('falls back to the ID call when the key call fails, and keeps it', async () => {
    const byKey = bad(); const fetchById = ok('id')
    const read = rowsReader({ id: 'x' }, { byKey, fetchById })
    expect((await read('s50', 'K', 1, 50)).items[0].tag).toBe('id')
    await read('s50', 'K', 2, 50)
    expect(byKey).toHaveBeenCalledTimes(1)
  })
  it('throws the first error when both fail, and never retries a connection error', async () => {
    const e1 = Object.assign(new Error('first'), { status: 400 })
    const byKey = vi.fn(async () => { throw e1 })
    await expect(rowsReader({ id: 'x' }, { byKey, fetchById: bad() })('s50', 'K', 1, 50)).rejects.toBe(e1)
    const login = Object.assign(new Error('login'), { code: 'SFMC_LOGIN_REQUIRED' })
    const fetchById = ok('id')
    await expect(rowsReader({ id: 'x' }, { byKey: vi.fn(async () => { throw login }), fetchById })('s50', 'K', 1, 50)).rejects.toBe(login)
    expect(fetchById).not.toHaveBeenCalled()
  })
  it('uses only the key call when the DE has no ID', async () => {
    const byKey = bad()
    await expect(rowsReader({ customerKey: 'K' }, { byKey, fetchById: ok('id') })('s50', 'K', 1, 50)).rejects.toThrow('400')
  })
})
