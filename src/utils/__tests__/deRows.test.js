import { describe, it, expect } from 'vitest'
import { rowsFrom, columnsFor, fetchRowsAt, loadRemainingRows, filterRows, reloadRows } from '../deRows.js'

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
