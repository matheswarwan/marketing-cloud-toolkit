import { describe, it, expect } from 'vitest'
import { retrieveEnvelope } from '../../background/soap.js'
import { fetchBounceFeed, fetchNotSentFeed, groupBounces, bouncesBySend, groupNotSent, fetchSendDetails, fetchEngagementFeed, perDay, FEED_PAGES } from '../sendEvents.js'
import { fetchJourneyEmailResults, journeyEmailSteps } from '../messagingApi.js'
import { fetchSubscriberAcrossBUs, statusSummary } from '../contactsLookup.js'

const resp = (status, body, requestId = '11111111-1111-1111-1111-111111111111') => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><RetrieveResponseMsg xmlns="http://exacttarget.com/wsdl/partnerAPI"><OverallStatus>${status}</OverallStatus><RequestID>${requestId}</RequestID>${body}</RetrieveResponseMsg></soap:Body></soap:Envelope>`

describe('SOAP envelope additions (2026-11-16)', () => {
  it('reads the new event objects, sends one IN value as equals, and adds business unit IDs', () => {
    for (const o of ['NotSentEvent', 'ListSend', 'ForwardedEmailEvent', 'ForwardedEmailOptInEvent', 'SMSMOEvent']) {
      expect(retrieveEnvelope({ stack: 's10', objectType: o, properties: ['EventDate'] }, 't')).toContain(`<ObjectType>${o}</ObjectType>`)
    }
    const one = retrieveEnvelope({ stack: 's10', objectType: 'TriggeredSendSummary', filter: { property: 'CustomerKey', operator: 'IN', values: ['206444'] } }, 't')
    expect(one).toContain('<SimpleOperator>equals</SimpleOperator><Value>206444</Value>')
    const two = retrieveEnvelope({ stack: 's10', objectType: 'TriggeredSendSummary', filter: { property: 'CustomerKey', operator: 'IN', values: ['a', 'b'] } }, 't')
    expect(two).toContain('<SimpleOperator>IN</SimpleOperator>')
    expect(retrieveEnvelope({ stack: 's10', objectType: 'Subscriber', clientIds: ['515010937', 100] }, 't')).toContain('<RetrieveRequest><ClientIDs><ID>515010937</ID><ID>100</ID></ClientIDs>')
    expect(() => retrieveEnvelope({ stack: 's10', objectType: 'Subscriber', clientIds: ['1</ID><x>'] }, 't')).toThrow(/business unit/)
  })
})

describe('send problems', () => {
  const bounces = '<Results><SendID>9</SendID><SubscriberKey>a</SubscriberKey><EventDate>2026-11-15T10:00:00</EventDate><BounceCategory>Hard bounce</BounceCategory><BounceType>immediate</BounceType><SMTPCode>550</SMTPCode><SMTPReason>No such user</SMTPReason></Results>'
    + '<Results><SendID>9</SendID><SubscriberKey>b</SubscriberKey><EventDate>2026-11-16T10:00:00</EventDate><BounceCategory>Hard bounce</BounceCategory><SMTPCode>550</SMTPCode></Results>'
    + '<Results><SendID>8</SendID><SubscriberKey>c</SubscriberKey><EventDate>2026-11-14T10:00:00</EventDate><BounceCategory>Soft bounce</BounceCategory><SMTPCode>421</SMTPCode><SMTPReason>Try later</SMTPReason></Results>'

  it('reads bounces since a date, newest first, grouped by reason and by send', async () => {
    let req
    const r = await fetchBounceFeed('s10', { days: 7, now: Date.parse('2026-11-16T12:00:00Z'), retrieve: async (x) => { req = x; return resp('OK', bounces) } })
    expect(req.filter).toEqual({ property: 'EventDate', operator: 'greaterThan', values: ['2026-11-09T12:00:00'], dates: true })
    expect(r.rows.map((x) => x.subscriberKey)).toEqual(['b', 'a', 'c'])
    expect(r.capped).toBe(false)
    expect(groupBounces(r.rows)).toMatchObject([{ category: 'Hard bounce', smtpCode: '550', count: 2, sends: 1, subscribers: 2, reason: 'No such user' }, { category: 'Soft bounce', count: 1 }])
    expect(bouncesBySend(r.rows)).toEqual([{ sendId: 9, count: 2, hard: 2 }, { sendId: 8, count: 1, hard: 0 }])
  })

  it('stops after a few pages and says SFMC had more', async () => {
    let calls = 0
    const r = await fetchNotSentFeed('s10', { retrieve: async () => { calls++; return resp('MoreDataAvailable', '<Results><SendID>1</SendID><EventType>Unsubscribed</EventType></Results>') } })
    expect(calls).toBe(FEED_PAGES)
    expect(r.capped).toBe(true)
    expect(groupNotSent(r.rows)).toEqual([{ eventType: 'Unsubscribed', count: FEED_PAGES }])
  })

  it('reads one send\'s lists, not-sent events and unsubscribes; a refused part does not hide the others', async () => {
    const seen = []
    const d = await fetchSendDetails('s10', 441901, {
      retrieve: async (x) => {
        seen.push([x.objectType, x.filter])
        if (x.objectType === 'ListSend') return resp('OK', '<Results><SendID>441901</SendID><List><ID>414</ID><ListName>All Subscribers</ListName></List><NumberSent>1</NumberSent><NumberDelivered>1</NumberDelivered><HardBounces>0</HardBounces></Results>')
        if (x.objectType === 'NotSentEvent') return resp('Error: nope', '')
        return resp('OK', '<Results><SendID>441901</SendID><SubscriberKey>z</SubscriberKey><EventDate>2026-11-01T00:00:00</EventDate><IsMasterUnsubscribed>true</IsMasterUnsubscribed></Results>')
      },
    })
    expect(seen.every(([, f]) => f.property === 'SendID' && f.values[0] === '441901')).toBe(true)
    expect(d.lists.rows).toEqual([expect.objectContaining({ listId: 414, listName: 'All Subscribers', sent: 1, delivered: 1, bounces: 0 })])
    expect(d.notSent.error).toMatch(/nope/)
    expect(d.notSentByType).toBe(null)
    expect(d.unsubscribes.rows).toEqual([{ sendId: 441901, subscriberKey: 'z', eventDate: '2026-11-01T00:00:00', master: true }])
  })
})

describe('engagement feeds', () => {
  it('reads inbound SMS with the fields SFMC answers (EventDate, MOCode, Carrier) and counts per day', async () => {
    let req
    const r = await fetchEngagementFeed('s10', 'sms', { retrieve: async (x) => { req = x; return resp('OK', '<Results><EventDate>2026-11-15T09:00:00</EventDate><MOCode>STOP</MOCode><Carrier>Rogers</Carrier></Results><Results><EventDate>2026-11-15T10:00:00</EventDate><MOCode>JOIN</MOCode></Results>') } })
    expect(req.objectType).toBe('SMSMOEvent')
    expect(req.properties).toEqual(['EventDate', 'MOCode', 'Carrier'])
    expect(r.rows[0]).toEqual({ eventDate: '2026-11-15T10:00:00', moCode: 'JOIN', carrier: '' })
    expect(perDay(r.rows)).toEqual([{ day: '2026-11-15', count: 2 }])
    await expect(fetchEngagementFeed('s10', 'nope', {})).rejects.toThrow()
  })
})

describe('journey email results', () => {
  const journey = { activities: [
    { key: 'EMAILV2-1', type: 'EMAILV2', name: 'Welcome', configurationArguments: { triggeredSendKey: '206444', triggeredSend: { emailName: 'Welcome email' } } },
    { key: 'EMAILV2-2', type: 'EMAILV2', name: 'Day 3', configurationArguments: { triggeredSendKey: '206445' } },
    { key: 'WAIT-1', type: 'WAIT' },
    { key: 'EMAILV2-3', type: 'EMAILV2', name: 'Draft step', configurationArguments: {} },
  ] }
  it('reads the triggered send counts behind each email step', async () => {
    expect(journeyEmailSteps(journey).map((s) => s.triggeredSendKey)).toEqual(['206444', '206445'])
    let req
    const rows = await fetchJourneyEmailResults('s10', journey, { retrieve: async (x) => { req = x; return resp('OK', '<Results><CustomerKey>206444</CustomerKey><Sent>5</Sent><Bounces>1</Bounces><UniqueOpens>2</UniqueOpens><UniqueClicks>1</UniqueClicks><OptOuts>0</OptOuts><NotSentDueToError>0</NotSentDueToError></Results>') } })
    expect(req.filter).toEqual({ property: 'CustomerKey', operator: 'IN', values: ['206444', '206445'] })
    expect(rows[0]).toMatchObject({ name: 'Welcome', emailName: 'Welcome email', counts: { sent: 5, bounces: 1, delivered: 4, opens: 2, clicks: 1 } })
    expect(rows[1].counts).toBe(null)
    expect(await fetchJourneyEmailResults('s10', { activities: [] })).toEqual([])
  })
})

describe('subscriber in every business unit', () => {
  it('asks every account, keeps only the listed fields and names the business units', async () => {
    let req
    const rows = await fetchSubscriberAcrossBUs('s10', {
      key: '2', buNames: new Map([[515010937, 'Mathes Sandbox']]),
      retrieve: async (x) => { req = x; return resp('OK', '<Results><Client><ID>515010937</ID></Client><ID>1</ID><SubscriberKey>2</SubscriberKey><Status>Active</Status><Attributes><Name>First Name</Name><Value>Aurea</Value></Attributes></Results><Results><Client><ID>100</ID></Client><ID>1</ID><SubscriberKey>2</SubscriberKey><Status>Unsubscribed</Status></Results>') },
    })
    expect(req.queryAllAccounts).toBe(true)
    expect(req.properties).toContain('Client.ID')
    expect(rows.map((r) => [r.businessUnit, r.status])).toEqual([['Mathes Sandbox', 'Active'], ['MID 100', 'Unsubscribed']])
    expect(JSON.stringify(rows)).not.toContain('Aurea')
    expect(statusSummary(rows)).toBe('Active in 1, Unsubscribed in 1')
  })
})
