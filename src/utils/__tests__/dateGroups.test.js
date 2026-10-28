import { describe, it, expect } from 'vitest'
import { getDateGroup, groupByDate } from '../dateGroups.js'

// Wednesday 14 October 2026, noon.
const now = new Date(2026, 9, 14, 12)
const at = (y, m, d) => new Date(y, m, d, 9).getTime()

describe('date groups', () => {
  it('labels recent dates', () => {
    expect(getDateGroup(at(2026, 9, 14), now).label).toBe('Today')
    expect(getDateGroup(at(2026, 9, 13), now).label).toBe('Yesterday')
    expect(getDateGroup(at(2026, 9, 12), now).label).toBe('This Week')
    expect(getDateGroup(at(2026, 9, 6), now).label).toBe('Last Week')
    expect(getDateGroup(at(2026, 9, 1), now).label).toBe('This Month')
    expect(getDateGroup(at(2026, 8, 20), now).label).toBe('Last Month')
    expect(getDateGroup(at(2026, 5, 20), now).label).toBe('June 2026')
  })

  it('groups newest first and keeps item order', () => {
    const groups = groupByDate([{ id: 'a', timeStamp: at(2026, 5, 1) }, { id: 'b', timeStamp: at(2026, 9, 14) }, { id: 'c', timeStamp: at(2026, 9, 14) }], now)
    expect(groups.map((g) => g.key)).toEqual(['today', 'm_2026_05'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'c'])
  })
  it('puts items without a usable date last', () => {
    expect(getDateGroup(undefined, now).label).toBe('Unknown date')
    expect(getDateGroup('nope', now).label).toBe('Unknown date')
    const groups = groupByDate([{ id: 'x' }, { id: 'y', timeStamp: at(2026, 9, 14) }], now)
    expect(groups.map((g) => g.key)).toEqual(['today', 'unknown'])
  })
})
