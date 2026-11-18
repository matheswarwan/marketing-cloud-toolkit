import { describe, it, expect } from 'vitest'
import { targetLink, targetFromQuery } from '../useUsage.js'

describe('Where used on a page of its own (Open in new tab)', () => {
  it('round-trips a field check through the address', () => {
    const target = { kind: 'field', de: { id: 'D1', name: 'Orders & Returns', customerKey: 'K/1' }, field: 'Amount' }
    const link = targetLink('s10', target)
    expect(link.startsWith('#/where-used/result?')).toBe(true)
    const query = Object.fromEntries(new URLSearchParams(link.split('?')[1]))
    expect(targetFromQuery(query)).toEqual({ stack: 's10', target })
  })
  it('refuses an address without a known check', () => {
    expect(targetFromQuery({})).toBeNull()
    expect(targetFromQuery({ stack: 's10', t: '{"kind":"nope"}' })).toBeNull()
    expect(targetFromQuery({ stack: 's10', t: 'not json' })).toBeNull()
    expect(targetFromQuery({ t: '{"kind":"de","de":{"name":"X"}}' })).toBeNull()
  })
})
