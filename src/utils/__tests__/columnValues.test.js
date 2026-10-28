import { describe, it, expect } from 'vitest'
import { valueKey, columnValueCounts, applyValueFilters, valueFiltering, duplicatesSql, distinctSql } from '../columnValues.js'

const rows = [
  { Coupon: '120', Type: 'Placed' },
  { Coupon: '121', Type: 'Settled' },
  { Coupon: '120', Type: 'Settled' },
  { Coupon: '', Type: 'Placed' },
  { Coupon: null, Type: 'Placed' },
  { Coupon: ' 122 ', Type: 'Changed' },
]

describe('column values (feedback #1012)', () => {
  it('counts distinct values, most common first, with blanks and repeats', () => {
    const s = columnValueCounts(rows, 'Coupon')
    expect(s).toMatchObject({ rows: 6, distinct: 4, blanks: 2, repeated: 1 })
    expect(s.values).toEqual([{ key: '', count: 2 }, { key: '120', count: 2 }, { key: '121', count: 1 }, { key: '122', count: 1 }])
    expect(valueKey(5)).toBe('5')
    expect(valueKey({ a: 1 })).toBe('{"a":1}')
  })

  it('keeps ticked values, and only repeated non-blank values for Duplicates only', () => {
    expect(applyValueFilters(rows, { Type: ['Placed'] }).length).toBe(3)
    expect(applyValueFilters(rows, {}, { Coupon: true }).map((r) => r.Type)).toEqual(['Placed', 'Settled'])
    // Repeats are counted within the rows the other filters keep.
    expect(applyValueFilters(rows, { Type: ['Settled'] }, { Coupon: true })).toEqual([])
    expect(applyValueFilters(rows, { Type: ['Placed'] }, { Coupon: true }, 'Type').length).toBe(2)
    expect(valueFiltering({ Type: [] }, { Coupon: false })).toBe(false)
    expect(valueFiltering({ Type: ['x'] })).toBe(true)
  })

  it('writes SQL for the whole DE, without ORDER BY (SFMC refuses it without TOP)', () => {
    expect(duplicatesSql('Coupon Events', 'CouponRef')).toBe('SELECT CouponRef, COUNT(*) AS NumberOfRows\nFROM [Coupon Events]\nWHERE CouponRef IS NOT NULL\nGROUP BY CouponRef\nHAVING COUNT(*) > 1')
    expect(distinctSql('Events', 'Event Type', { shared: true })).toBe('SELECT [Event Type], COUNT(*) AS NumberOfRows\nFROM ENT.Events\nGROUP BY [Event Type]')
  })
})
