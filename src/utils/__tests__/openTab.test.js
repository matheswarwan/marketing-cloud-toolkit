import { describe, it, expect } from 'vitest'
import { nextTo } from '../openTab.js'

describe('nextTo (feedback #74)', () => {
  it('places the new tab right after the given tab, in its window', () => {
    expect(nextTo({ id: 7, index: 3, windowId: 2 }, { url: 'u' })).toEqual({ url: 'u', index: 4, windowId: 2, openerTabId: 7 })
  })
  it('leaves the properties alone without a tab', () => {
    expect(nextTo(null, { url: 'u', active: false })).toEqual({ url: 'u', active: false })
    expect(nextTo({}, { url: 'u' })).toEqual({ url: 'u' })
  })
})
