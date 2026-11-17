import { describe, it, expect, vi } from 'vitest'
import { legacyPageParams, legacyRows } from '../automationPaging.js'

const ids = (from, to) => Array.from({ length: to - from }, (_, i) => from + i)
// Like SFMC's legacy list: `$skip` is a page number; past the end, no rows and total 0.
const reader = (count) => vi.fn(async (params) => {
  const top = Number(params.match(/\$top=(\d+)/)[1])
  const page = Number(params.match(/\$skip=(\d+)/)[1])
  const entries = ids(0, count).slice(page * top, page * top + top)
  return { entries, total: entries.length ? count : 0 }
})

describe('legacy automation paging (feedback #1100)', () => {
  it('turns a row into a page number', () => {
    expect(legacyPageParams(0, 50)).toBe('$top=50&$skip=0')
    expect(legacyPageParams(100, 50)).toBe('$top=50&$skip=2')
    expect(legacyPageParams(149, 50)).toBe('$top=50&$skip=2')
    expect(legacyPageParams(-5, 50)).toBe('$top=50&$skip=0')
  })

  it('reads one page on a page boundary', async () => {
    const read = reader(452)
    expect(await legacyRows(100, 50, read)).toEqual({ entries: ids(100, 150), total: 452 })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads two pages and cuts them when the row is inside a page', async () => {
    const read = reader(452)
    expect(await legacyRows(120, 50, read)).toEqual({ entries: ids(120, 170), total: 452 })
    expect(read.mock.calls.map((c) => c[0])).toEqual(['$top=50&$skip=2', '$top=50&$skip=3'])
  })

  it('keeps the total from a page with rows at the end of the list', async () => {
    expect(await legacyRows(430, 50, reader(452))).toEqual({ entries: ids(430, 452), total: 452 })
  })
})
