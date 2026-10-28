import { describe, it, expect, vi, beforeEach } from 'vitest'

const sfmcFetch = vi.fn()
vi.mock('../sfmcApi.js', () => ({ sfmcFetch: (...a) => sfmcFetch(...a) }))
const { fetchContactCount, searchContactKey, parseContacts } = await import('../contactsApi.js')

beforeEach(() => sfmcFetch.mockReset())

describe('contacts (feedback #57)', () => {
  it('reads totalCount from the count call', async () => {
    sfmcFetch.mockResolvedValue({ totalCount: 558998 })
    await expect(fetchContactCount('s10')).resolves.toBe(558998)
    expect(sfmcFetch.mock.calls[0][0]).toBe('https://mc.s10.marketingcloudapps.com/contactsmeta/fuelapi/contacts/v1/addresses/count/?$pageSize=25&$page=1&$orderBy=contactKey%20ASC')
    expect(sfmcFetch.mock.calls[0].slice(1)).toEqual(['POST', { queryFilter: { hasCriteria: true, rootExpressionSet: { expressions: [] } } }])
  })

  it('searches Contact Key (definition 101) with Equal', async () => {
    sfmcFetch.mockResolvedValue({ addresses: [], totalCount: 0 })
    await searchContactKey('s10', ' 000001 ')
    const [url, method, body] = sfmcFetch.mock.calls[0]
    expect(url).toContain('/contactsmeta/fuelapi/contacts-internal/v1/addresses/search/')
    expect(method).toBe('POST')
    expect(body.queryFilter.rootExpressionSet.expressions).toEqual([{ customerDataDefinitionID: 101, operator: 'Equal', values: ['000001'] }])
  })

  it('reads contacts and their attribute values', () => {
    const r = parseContacts({
      totalCount: 1,
      addresses: [{ contactID: 42, modifiedDate: '2026-10-01T00:00:00', valueSets: [{ name: 'Email Addresses', values: [{ name: 'Email Address', innerValue: 'a@example.com' }, { name: 'Contact Key', innerValue: '000001' }] }] }],
    })
    expect(r.total).toBe(1)
    expect(r.contacts[0]).toMatchObject({ contactKey: '000001', contactId: 42 })
    expect(r.contacts[0].values[0]).toEqual({ set: 'Email Addresses', name: 'Email Address', value: 'a@example.com' })
  })
})

import { parseKeyList, searchContactKeys, contactDetailId } from '../contactsApi.js'
describe('many contact keys (feedback #151)', () => {
  it('reads keys from pasted text or a file', () => {
    expect(parseKeyList('a\r\nb, c;\t"d"\n\na')).toEqual({ keys: ['a', 'b', 'c', 'd'], skipped: 0 })
    expect(parseKeyList('1\n2\n3', 2)).toEqual({ keys: ['1', '2'], skipped: 1 })
  })
  it('searches each key, a few at a time, keeping the order', async () => {
    const seen = []
    const search = async (_s, k) => { seen.push(k); if (k === 'bad') throw new Error('nope'); return { contacts: k === 'x' ? [] : [{ contactKey: k }] } }
    const r = await searchContactKeys('s1', ['a', 'x', 'bad', 'b'], { search, limit: 2 })
    expect(r.map((x) => [x.key, x.contacts.length, x.error])).toEqual([['a', 1, ''], ['x', 0, ''], ['bad', 0, 'nope'], ['b', 1, '']])
  })
  it('finds the encoded contact id', () => {
    expect(contactDetailId({ id: 'MjgxMjYyMDo2MTow' })).toBe('MjgxMjYyMDo2MTow')
    expect(contactDetailId({ id: 2812620 })).toBe(null)
  })
})
