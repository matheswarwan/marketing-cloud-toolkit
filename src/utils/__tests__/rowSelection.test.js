import { describe, it, expect } from 'vitest'
import { rangeSelect, rowsAsTsv } from '../rowSelection.js'

describe('ticked rows (feedback #138)', () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]
  it('ticks one row, then a Shift range, then unticks a range', () => {
    let s = rangeSelect(new Set(), rows, 0)
    expect([...s]).toEqual([rows[0]])
    s = rangeSelect(s, rows, 2, 0)
    expect(rows.filter((r) => s.has(r))).toEqual(rows.slice(0, 3))
    s = rangeSelect(s, rows, 1, 2)
    expect(rows.filter((r) => s.has(r))).toEqual([rows[0]])
  })
  it('copies tab-separated with the header, flattening tabs and new lines', () => {
    expect(rowsAsTsv(['a', 'b'], [{ a: 'x\ty', b: null }, { a: 'line\nbreak', b: 2 }])).toBe('a\tb\nx y\t\nline break\t2')
  })
})
