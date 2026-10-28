import { describe, it, expect } from 'vitest'
import { sortRows, filterRows, nextSort, sortKey, isSortable, isFilterable } from '../tableSort.js'

const columns = [
  { key: 'pick', label: '' },
  { key: 'name', label: 'Name', hideable: false },
  { key: 'status', label: 'Status', sortValue: (r) => ({ 3: 'Running', 2: 'Ready' })[r.status] ?? r.status },
  { key: 'modifiedDate', label: 'Modified', type: 'date' },
  { key: 'rows', label: 'Rows', sortValue: (r) => r.count ?? null },
  { key: 'actions', label: '', hideable: false },
]
const rows = [
  { id: 1, name: 'beta', status: 3, modifiedDate: '2026-10-02T10:00:00', count: 9 },
  { id: 2, name: 'Alpha', status: 2, modifiedDate: '2026-09-30T10:00:00', count: 100 },
  { id: 3, name: 'gamma 10', status: 'Error', modifiedDate: '', count: null },
  { id: 4, name: 'gamma 9', status: 2, modifiedDate: '2026-10-20T08:00:00', count: 20 },
]
const ids = (list) => list.map((r) => r.id)

describe('table sorting (feedback #126)', () => {
  it('sorts text case-insensitively and numbers inside text naturally', () => {
    expect(ids(sortRows(rows, columns, { key: 'name', dir: 'asc' }))).toEqual([2, 1, 4, 3])
    expect(ids(sortRows(rows, columns, { key: 'name', dir: 'desc' }))).toEqual([3, 4, 1, 2])
  })
  it('sorts dates as dates and keeps empty values last both ways', () => {
    expect(ids(sortRows(rows, columns, { key: 'modifiedDate', dir: 'asc' }))).toEqual([2, 1, 4, 3])
    expect(ids(sortRows(rows, columns, { key: 'modifiedDate', dir: 'desc' }))).toEqual([4, 1, 2, 3])
  })
  it('sorts numbers as numbers through sortValue', () => {
    expect(ids(sortRows(rows, columns, { key: 'rows', dir: 'asc' }))).toEqual([1, 4, 2, 3])
    expect(ids(sortRows(rows, columns, { key: 'rows', dir: 'desc' }))).toEqual([2, 4, 1, 3])
  })
  it('sorts statuses by their names, stable for ties', () => {
    expect(ids(sortRows(rows, columns, { key: 'status', dir: 'asc' }))).toEqual([3, 2, 4, 1])
  })
  it('leaves the order alone with no sort or an unknown column', () => {
    expect(sortRows(rows, columns, null)).toBe(rows)
    expect(sortRows(rows, columns, { key: 'nope', dir: 'asc' })).toBe(rows)
  })
  it('cycles ascending, descending, off', () => {
    let s = nextSort(null, 'name')
    expect(s).toEqual({ key: 'name', dir: 'asc' })
    s = nextSort(s, 'name')
    expect(s).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort(s, 'name')).toBeNull()
    expect(nextSort(s, 'status')).toEqual({ key: 'status', dir: 'asc' })
  })
  it('turns values into comparable keys', () => {
    expect(sortKey('42')).toBe(42)
    expect(sortKey('42', 'text')).toBe('42')
    expect(sortKey('  ')).toBeNull()
    expect(sortKey('2026-10-24')).toBe(Date.parse('2026-10-24'))
    expect(sortKey('2024 campaign')).toBe('2024 campaign')
  })
  it('skips columns without a label or opted out', () => {
    expect(isSortable(columns[0])).toBe(false)
    expect(isSortable(columns[1])).toBe(true)
    expect(isSortable({ key: 'x', label: 'X', sortable: false })).toBe(false)
    expect(isFilterable({ key: 'x', label: 'X', filterable: false })).toBe(false)
    expect(isFilterable(columns[5])).toBe(false)
  })
})

describe('table filters (feedback #126)', () => {
  it('matches case-insensitive text in every filled-in column', () => {
    expect(ids(filterRows(rows, columns, { name: 'GAMMA' }))).toEqual([3, 4])
    expect(ids(filterRows(rows, columns, { name: 'gamma', status: 'ready' }))).toEqual([4])
    expect(ids(filterRows(rows, columns, { name: '  ' }))).toEqual([1, 2, 3, 4])
  })
  it('filters computed cells and dates', () => {
    expect(ids(filterRows(rows, columns, { status: 'running' }))).toEqual([1])
    expect(ids(filterRows(rows, columns, { modifiedDate: '2026-10' }))).toEqual([1, 4])
    expect(ids(filterRows(rows, columns, { rows: '20' }))).toEqual([4])
  })
})
