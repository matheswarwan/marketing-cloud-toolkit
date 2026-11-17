import { describe, it, expect } from 'vitest'
import {
  fetchSuppressionLists, suppressionListRow, suppressionContextRow, describeContext, joinContexts, suppressionSummary, retrieveWithFallbacks, DEFINITION_PROPS,
  suppressionPreviewTo,
} from '../suppressionLists.js'
import {
  normalizeMobile, parseLookupInput, lookupBody, smsSubscriptionRow, subscriptionsFrom, notInAnswer, statusWords, isSmsRefused, lookupSmsSubscriptions, maskDigits, SMS_LOOKUP_LIMIT,
} from '../smsSubscriptions.js'
import { retrieveEnvelope } from '../../background/soap.js'

const resp = (results, status = 'OK') => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><RetrieveResponseMsg xmlns="http://exacttarget.com/wsdl/partnerAPI"><OverallStatus>${status}</OverallStatus><RequestID>r1</RequestID>${results}</RetrieveResponseMsg></soap:Body></soap:Envelope>`

describe('Suppression lists (API idea 16)', () => {
  it('opens a list in Preview data by its key (a suppression list is a data extension)', () => {
    expect(suppressionPreviewTo({ id: '0a3b-1', key: 'SendGridAutoSuppression', name: 'SendGrid Auto Suppression' }))
      .toEqual({ path: '/data-extensions/preview', query: { id: '0a3b-1', key: 'SendGridAutoSuppression', name: 'SendGrid Auto Suppression' } })
    expect(suppressionPreviewTo({ id: 'x', key: '', name: 'No key' })).toBe(null)
  })

  it('turns definitions and contexts into rows', () => {
    expect(suppressionListRow({ ObjectID: 'A', ID: '5', CustomerKey: 'k', Name: 'Competitors', SubscriberCount: '42', CreatedDate: '0001-01-01T00:00:00', Client: { ID: '100' } }))
      .toMatchObject({ id: 'A', numericId: 5, key: 'k', name: 'Competitors', count: 42, createdDate: '', mid: 100 })
    expect(suppressionListRow({ Name: 'x' }).count).toBe(null)
    expect(suppressionContextRow({ ObjectID: 'c', Context: 'SendClassification', Definition: { ObjectID: 'A' }, SendClassification: { ObjectID: 'SC1' }, Send: '', AppliesToAllSends: 'false' }))
      .toMatchObject({ context: 'SendClassification', definitionId: 'A', classificationId: 'SC1', sendId: null, appliesToAll: false })
  })

  it('describes where a context applies, with names', () => {
    const names = { classifications: [{ id: 'sc1', key: 'Default Commercial', name: 'Default Commercial' }], profiles: [{ id: 'p1', key: 'sp', name: 'Brand' }] }
    expect(describeContext({ context: 'Enterprise' }).kind).toBe('Enterprise')
    expect(describeContext({ context: 'BusinessUnit', mid: 200 }).label).toContain('MID 200')
    expect(describeContext({ context: 'SendClassification', classificationId: 'SC1' }, names).label).toBe('Sends with the send classification Default Commercial')
    expect(describeContext({ context: 'SenderProfile', senderProfileKey: 'sp' }, names).label).toBe('Sends with the sender profile Brand')
    expect(describeContext({ context: 'Send', sendId: 77 }).label).toBe('The send with JobID 77')
    expect(describeContext({ context: 'Publication', publicationId: 9 }).kind).toBe('Publication')
    expect(describeContext({ context: 'Something' }).label).toBe('Something (as SFMC names it)')
  })

  it('joins contexts to lists by ObjectID or key and counts the rest', () => {
    const lists = [{ id: 'A', key: 'ka', name: 'A' }, { id: 'B', key: 'kb', name: 'B' }]
    const { lists: out, orphans } = joinContexts(lists, [
      { definitionId: 'a', context: 'Enterprise' }, { definitionKey: 'ka', context: 'BusinessUnit' }, { definitionId: 'Z', context: 'Enterprise' },
    ])
    expect(out[0].contexts).toHaveLength(2)
    expect(out[1].contexts).toHaveLength(0)
    expect(orphans).toBe(1)
    expect(suppressionSummary([{ count: 3, contexts: [1] }, { count: null, contexts: [] }])).toEqual({ lists: 2, subscribers: 3, unlinked: 1 })
    expect(suppressionSummary([{ count: 3, contexts: [] }], false).unlinked).toBe(null)
  })

  it('falls back to shorter property lists when SFMC refuses a property', async () => {
    const calls = []
    const retrieve = async (r) => {
      calls.push(r.properties.length)
      if (r.properties.length > 3) return resp('', 'Error: The Request Property(s) Category do not match with the fields of SuppressionListDefinition retrieve')
      return resp('<Results><ObjectID>A</ObjectID><Name>L</Name></Results>')
    }
    const rows = await retrieveWithFallbacks('s10', 'SuppressionListDefinition', DEFINITION_PROPS, { retrieve })
    expect(rows).toHaveLength(1)
    expect(calls).toEqual([DEFINITION_PROPS[0].length, DEFINITION_PROPS[1].length, DEFINITION_PROPS[2].length])
    await expect(retrieveWithFallbacks('s10', 'SuppressionListDefinition', DEFINITION_PROPS, { retrieve: async () => resp('', 'Error: Login failed') })).rejects.toThrow(/Login failed/)
  })

  it('reads lists with their contexts; a failed context read is a note', async () => {
    const seen = []
    const retrieve = async (r) => {
      seen.push(r)
      // Every request is a valid Retrieve envelope for an allowed object.
      retrieveEnvelope({ ...r, stack: 's10' }, 't')
      if (r.objectType === 'SuppressionListDefinition') return resp('<Results><ObjectID>A</ObjectID><CustomerKey>ka</CustomerKey><Name>Zeta</Name><SubscriberCount>10</SubscriberCount></Results><Results><ObjectID>B</ObjectID><Name>Alpha</Name><SubscriberCount>5</SubscriberCount></Results>')
      if (r.objectType === 'SuppressionListContext') return resp('<Results><ObjectID>c1</ObjectID><Context>SendClassification</Context><Definition><ObjectID>A</ObjectID></Definition><SendClassification><ObjectID>sc1</ObjectID></SendClassification></Results>')
      if (r.objectType === 'SendClassification') return resp('<Results><ObjectID>sc1</ObjectID><CustomerKey>dc</CustomerKey><Name>Default Commercial</Name></Results>')
      return resp('')
    }
    const d = await fetchSuppressionLists('s10', { retrieve, allBusinessUnits: true })
    expect(d.lists.map((l) => l.name)).toEqual(['Alpha', 'Zeta'])
    expect(d.lists[1].appliesTo).toBe('Sends with the send classification Default Commercial')
    expect(d.contextsRead).toBe(true)
    expect(seen.find((r) => r.objectType === 'SuppressionListDefinition').queryAllAccounts).toBe(true)

    const failing = async (r) => (r.objectType === 'SuppressionListContext' ? resp('', 'Error: Not authorized') : retrieve(r))
    const d2 = await fetchSuppressionLists('s10', { retrieve: failing })
    expect(d2.contextsRead).toBe(false)
    expect(d2.notes[0]).toMatch(/could not be read/)
    expect(d2.lists).toHaveLength(2)
  })
})

describe('SMS subscriptions (API idea 17)', () => {
  it('normalizes mobile numbers to country-code format', () => {
    expect(normalizeMobile('+1 (555) 123-4567')).toBe('15551234567')
    expect(normalizeMobile('0044 7700 900123')).toBe('447700900123')
    expect(normalizeMobile('abc')).toBe(null)
    expect(normalizeMobile('123')).toBe(null)
  })

  it('parses pasted entries, detects the kind and caps at 500', () => {
    const p = parseLookupInput('+15551234567\n15551234567, 447700900123')
    expect(p).toMatchObject({ kind: 'mobile', values: ['15551234567', '447700900123'], invalid: [], over: 0 })
    expect(parseLookupInput('key-1\nkey-2').kind).toBe('key')
    const forced = parseLookupInput('15551234567\nnot a number', 'mobile')
    expect(forced.values).toEqual(['15551234567'])
    expect(forced.invalid).toEqual(['not a number'])
    const many = parseLookupInput(Array.from({ length: 510 }, (_, i) => `k${i}`).join('\n'))
    expect(many.values).toHaveLength(SMS_LOOKUP_LIMIT)
    expect(many.over).toBe(10)
    expect(lookupBody('mobile', ['1'])).toEqual({ MobileNumbers: ['1'] })
    expect(lookupBody('key', ['k'])).toEqual({ SubscriberKeys: ['k'] })
  })

  it('reads answer rows loosely and finds entries with no subscription', () => {
    const list = subscriptionsFrom({ contacts: [{ mobileNumber: '15551234567', shortCode: '88769', keyword: 'PIZZA', status: 'active', optInDate: '2026-01-01T10:00:00' }] })
    const rows = list.map(smsSubscriptionRow)
    expect(rows[0]).toMatchObject({ mobileNumber: '15551234567', shortCode: '88769', keyword: 'PIZZA', status: 'active' })
    expect(subscriptionsFrom([{ a: 1 }])).toHaveLength(1)
    expect(subscriptionsFrom({ nothing: true })).toEqual([])
    expect(notInAnswer('mobile', ['15551234567', '15550000000'], rows)).toEqual(['15550000000'])
    expect(statusWords('active')).toBe('Opted in')
    expect(statusWords('Opted Out')).toBe('Opted out')
    expect(statusWords('weird')).toBe('weird')
  })

  it('posts the lookup, and treats a refusal as a note', async () => {
    const calls = []
    const fetch = async (url, method, body) => { calls.push({ url, method, body }); return { contacts: [{ subscriberKey: 'k1', keyword: 'JOIN', status: 'inactive' }] } }
    const r = await lookupSmsSubscriptions('s10', 'key', ['k1', 'k2'], fetch)
    expect(calls[0]).toEqual({ url: 'https://jbinteractions.s10.marketingcloudapps.com/fuelapi/sms/v1/contacts/subscriptions', method: 'POST', body: { SubscriberKeys: ['k1', 'k2'] } })
    expect(r.notFound).toEqual(['k2'])

    const refused = Object.assign(new Error('SFMC API error 403: Forbidden'), { status: 403 })
    expect(await lookupSmsSubscriptions('s10', 'mobile', ['15551234567'], async () => { throw refused })).toEqual({ refused: true, status: 403 })
    expect(isSmsRefused({ status: 400, message: 'MobileConnect is not enabled for this account' })).toBe(true)
    expect(isSmsRefused({ status: 500, message: 'boom' })).toBe(false)

    const other = Object.assign(new Error('SFMC API error 500: bad number 15551234567'), { status: 500 })
    await expect(lookupSmsSubscriptions('s10', 'mobile', ['15551234567'], async () => { throw other })).rejects.toThrow('SFMC API error 500: bad number [number]')
    expect(maskDigits('+1 555 123 4567 and 42')).toBe('[number] and 42')
    expect(await lookupSmsSubscriptions('s10', 'mobile', [], fetch)).toEqual({ rows: [], notFound: [] })
  })
})

describe('sfmcFetchQuiet (API idea 17: no phone numbers in the API console)', () => {
  it('keeps the body, the answer and numbers in errors out of the log', async () => {
    const { sfmcFetchQuiet, setApiLogCallback, recentApiErrors } = await import('../sfmcApi.js')
    const logs = []
    setApiLogCallback((e) => logs.push(e))
    let reply = { data: { contacts: [{ mobileNumber: '15551234567' }] } }
    globalThis.chrome = { runtime: { lastError: null, sendMessage: (msg, cb) => cb(reply) } }
    try {
      await sfmcFetchQuiet('https://jbinteractions.s10.marketingcloudapps.com/fuelapi/sms/v1/contacts/subscriptions', 'POST', { MobileNumbers: ['15551234567'] })
      reply = { error: 'SFMC API error 400: 15551234567 is not valid', status: 400 }
      await expect(sfmcFetchQuiet('https://jbinteractions.s10.marketingcloudapps.com/fuelapi/sms/v1/contacts/subscriptions', 'POST', { MobileNumbers: ['15551234567'] })).rejects.toThrow()
      expect(JSON.stringify(logs)).not.toContain('15551234567')
      expect(JSON.stringify(recentApiErrors())).not.toContain('15551234567')
    } finally {
      setApiLogCallback(null)
      delete globalThis.chrome
    }
  })
})
