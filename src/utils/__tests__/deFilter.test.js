import { describe, it, expect } from 'vitest'
import { filterDEList, isQueryStudioResultsDE } from '../deApi.js'

const list = [
  { id: '1', name: 'Customers' },
  { id: '2', name: 'QueryStudioResults at 2026-10-26 1:05 PM' },
  { id: '3', name: 'Parent List', sourceType: 'shared' },
  { id: '4', name: 'Contact_Salesforce', sourceType: 'sync' },
  { id: '5', name: 'IGO_PROFILES' },
]
const ids = (r) => r.map((d) => d.id)

describe('filterDEList (feedback #1004)', () => {
  it('keeps everything by default', () => expect(ids(filterDEList(list))).toEqual(['1', '2', '3', '4', '5']))
  it('filters by source', () => {
    expect(ids(filterDEList(list, { source: 'local' }))).toEqual(['1', '2', '5'])
    expect(ids(filterDEList(list, { source: 'shared' }))).toEqual(['3'])
    expect(ids(filterDEList(list, { source: 'sync' }))).toEqual(['4'])
  })
  it('hides QueryStudioResults on its own', () => {
    expect(ids(filterDEList(list, { hideQueryStudio: true }))).toEqual(['1', '3', '4', '5'])
    expect(isQueryStudioResultsDE('querystudioresults x')).toBe(true)
    expect(isQueryStudioResultsDE('My QueryStudioResults')).toBe(false)
  })
  it('hides system DEs', () => expect(ids(filterDEList(list, { hideSystem: true }))).toEqual(['1', '3', '4']))
})

describe('DE descriptions (#1008)', () => {
  it('keeps the description from the list item', async () => {
    const { toDE, deRowCountOf } = await import('../deApi.js')
    expect(toDE({ id: 'a', name: 'X', description: 'Daily copy' }).description).toBe('Daily copy')
    expect(toDE({ id: 'a', name: 'X' }).description).toBe('')
    expect(deRowCountOf({ totalRowCount: 3, description: 'D' })).toBe(3)
    expect(() => deRowCountOf({})).toThrow()
  })
})
