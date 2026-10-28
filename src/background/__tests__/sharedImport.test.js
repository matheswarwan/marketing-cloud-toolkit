import { describe, it, expect } from 'vitest'
import { sharedQueryRecords, SHARE_PAGE_PREFIX } from '../sharedImport.js'
import { personalDataHints, sharePayload, shareAllowed } from '../../utils/share.js'
import { policy } from '../../utils/policy.js'

const page = `${SHARE_PAGE_PREFIX}abc123?x=1`

describe('IMPORT_SHARED_QUERY checks', () => {
  it('accepts one query from a share page and keeps only known fields', () => {
    const out = sharedQueryRecords({ sql_1700000000000: { queryText: 'SELECT 1', name: 'Q', isFavourite: true, evil: 'x', runs: [{}] } }, page)
    expect(out).toEqual({ sql_1700000000000: { id: 'sql_1700000000000', queryText: 'SELECT 1', timeStamp: 1700000000000, url: `${SHARE_PAGE_PREFIX}abc123`, name: 'Q', isFavourite: false } })
  })
  it('refuses other senders, other keys, several records and empty SQL', () => {
    expect(sharedQueryRecords({ sql_1: { queryText: 'SELECT 1' } }, 'https://mc.s7.exacttarget.com/x')).toBeNull()
    expect(sharedQueryRecords({ _shareEnabled: { queryText: 'x' } }, page)).toBeNull()
    expect(sharedQueryRecords({ sql_1: { queryText: 'a' }, sql_2: { queryText: 'b' } }, page)).toBeNull()
    expect(sharedQueryRecords({ sql_1: { queryText: '  ' } }, page)).toBeNull()
  })
})

describe('share helpers', () => {
  it('sends only the name and the SQL', () => {
    expect(sharePayload('x'.repeat(300), 'SELECT 1')).toEqual({ name: 'x'.repeat(200), queryText: 'SELECT 1' })
  })
  it('points out e-mail addresses and phone-like numbers', () => {
    expect(personalDataHints("WHERE Email = 'jane@example.com' OR Phone = '+1 (604) 555-0199'")).toEqual(['1 e-mail address', '1 phone-like number'])
    expect(personalDataHints('SELECT TOP 100 SubscriberKey FROM _Sent WHERE JobID = 12345')).toEqual([])
  })
  it('is offered only when turned on and not blocked by policy', () => {
    expect(shareAllowed(undefined)).toBe(false)
    expect(shareAllowed(true)).toBe(true)
    policy.disableShare = true
    expect(shareAllowed(true)).toBe(false)
    policy.disableShare = false
  })
})
