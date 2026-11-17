import { describe, it, expect } from 'vitest'
import {
  looksLikeEmail, fetchSubscribers, fetchListMemberships, fetchBounces, fetchUnsubscribes, fetchRecentSends, whyNoEmail,
  deleteOperationRow, fetchDeleteOperations, fetchAllDeleteOperations, fetchDeleteStatus, fetchDeleteSummary, deleteSummaryTotals,
} from '../contactsLookup.js'

const resp = (results, status = 'OK') => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><RetrieveResponseMsg xmlns="http://exacttarget.com/wsdl/partnerAPI"><OverallStatus>${status}</OverallStatus><RequestID>a1b2c3d4-0000-0000-0000-000000000001</RequestID>${results}</RetrieveResponseMsg></soap:Body></soap:Envelope>`

describe('Subscriber lookup (2026-11-10)', () => {
  it('tells an email address from a key', () => {
    expect(looksLikeEmail('pat@example.com')).toBe(true)
    expect(looksLikeEmail(' 0031x000004AbcD ')).toBe(false)
    expect(looksLikeEmail('a@b')).toBe(false)
  })

  it('reads a subscriber by key without its profile attributes', async () => {
    let req
    const retrieve = async (r) => { req = r; return resp('<Results><ID>12</ID><SubscriberKey>K1</SubscriberKey><EmailAddress>pat@example.com</EmailAddress><Status>Held</Status><CreatedDate>2025-01-02T03:04:05</CreatedDate><UnsubscribedDate>0001-01-01T00:00:00</UnsubscribedDate><EmailTypePreference>HTML</EmailTypePreference><Attributes><Name>First Name</Name><Value>Pat</Value></Attributes></Results>') }
    const [s] = await fetchSubscribers('s10', { key: 'K1', retrieve })
    expect(req.objectType).toBe('Subscriber')
    expect(req.filter).toEqual({ property: 'SubscriberKey', operator: 'equals', values: ['K1'] })
    expect(req.properties).not.toContain('ModifiedDate')
    expect(s).toEqual({ id: 12, key: 'K1', email: 'pat@example.com', status: 'Held', createdDate: '2025-01-02T03:04:05', unsubscribedDate: '', emailType: 'HTML' })
    expect(JSON.stringify(s)).not.toContain('Pat"')
  })

  it('filters by email address and can return several subscribers', async () => {
    let req
    const retrieve = async (r) => { req = r; return resp('<Results><SubscriberKey>A</SubscriberKey></Results><Results><SubscriberKey>B</SubscriberKey></Results>') }
    const list = await fetchSubscribers('s10', { email: 'x@y.com', retrieve })
    expect(req.filter.property).toBe('EmailAddress')
    expect(list.map((s) => s.key)).toEqual(['A', 'B'])
  })

  it('joins list memberships to list names, and skips the list read when there are none', async () => {
    const calls = []
    const retrieve = async (r) => {
      calls.push(r)
      return r.objectType === 'ListSubscriber'
        ? resp('<Results><ListID>5</ListID><Status>Unsubscribed</Status></Results><Results><ListID>3</ListID><Status>Active</Status></Results>')
        : resp('<Results><ID>3</ID><ListName>All Subscribers</ListName><Type>Private</Type></Results><Results><ID>5</ID><ListName>Newsletter</ListName></Results>')
    }
    const lists = await fetchListMemberships('s10', 'K1', { retrieve })
    expect(lists.map((l) => [l.listName, l.status])).toEqual([['All Subscribers', 'Active'], ['Newsletter', 'Unsubscribed']])
    expect(calls[1].filter).toEqual({ property: 'ID', operator: 'greaterThan', values: ['0'] })
    const none = []
    expect(await fetchListMemberships('s10', 'K1', { retrieve: async (r) => { none.push(r); return resp('') } })).toEqual([])
    expect(none.length).toBe(1)
  })

  it('reads events newest first and keeps the latest 20 sends', async () => {
    const bounces = await fetchBounces('s10', 'K1', { retrieve: async (r) => {
      expect(r.properties).not.toContain('ListID')
      return resp('<Results><SendID>1</SendID><EventDate>2026-01-01T00:00:00</EventDate><BounceCategory>Soft bounce</BounceCategory></Results><Results><SendID>2</SendID><EventDate>2026-02-01T00:00:00</EventDate><BounceCategory>Hard bounce</BounceCategory><SMTPReason>550 no such user</SMTPReason></Results>')
    } })
    expect(bounces.map((b) => b.sendId)).toEqual([2, 1])
    const unsubs = await fetchUnsubscribes('s10', 'K1', { retrieve: async () => resp('<Results><SendID>9</SendID><IsMasterUnsubscribed>true</IsMasterUnsubscribed></Results>') })
    expect(unsubs[0]).toMatchObject({ sendId: 9, master: true })
    const sent = Array.from({ length: 25 }, (_, i) => `<Results><SendID>${i}</SendID><EventDate>2026-01-${String(i + 1).padStart(2, '0')}T00:00:00</EventDate></Results>`).join('')
    const recent = await fetchRecentSends('s10', 'K1', { retrieve: async () => resp(sent) })
    expect(recent.total).toBe(25)
    expect(recent.rows.length).toBe(20)
    expect(recent.rows[0].sendId).toBe(24)
  })

  it('explains why someone may not get email', () => {
    const now = Date.parse('2026-11-10T00:00:00Z')
    expect(whyNoEmail({ notFound: true })[0]).toMatch(/Not found at All Subscribers/)
    const out = whyNoEmail({
      subscriber: { status: 'Unsubscribed', unsubscribedDate: '2026-03-04T00:00:00' },
      lists: [{ listName: 'Newsletter', status: 'Unsubscribed' }, { listName: 'Other', status: 'Active' }],
      bounces: [{ category: 'Hard bounce', type: '', smtpReason: '550 no such user', eventDate: '2026-10-01T00:00:00Z' }, { category: 'Hard bounce', eventDate: '2025-01-01T00:00:00Z' }],
      unsubscribes: [{ master: true }],
    }, now)
    expect(out[0]).toMatch(/Unsubscribed at All Subscribers since 2026-03-04/)
    expect(out[1]).toMatch(/the list Newsletter/)
    expect(out[2]).toMatch(/1 hard bounce in the last 90 days \(latest: 550 no such user\)/)
    expect(out.length).toBe(3)
    expect(whyNoEmail({ subscriber: { status: 'Active' }, lists: [], bounces: [], unsubscribes: [] })).toEqual([])
    expect(whyNoEmail({ subscriber: { status: 'Held' } })[0]).toMatch(/Held/)
  })
})

describe('Contact deletions (2026-11-10)', () => {
  it('reads pages of delete operations', async () => {
    const urls = []
    const fetch = async (url) => { urls.push(url); return { page: 1, pageSize: 50, count: 0 } }
    expect(await fetchDeleteOperations('s10', 1, fetch)).toEqual({ page: 1, pageSize: 50, count: 0, items: [] })
    expect(urls[0]).toBe('https://jbinteractions.s10.marketingcloudapps.com/fuelapi/contacts/v1/contacts/deleteOperations?$page=1&$pagesize=50')
    let page = 0
    const many = async () => { page++; return { count: 60, items: Array.from({ length: page === 1 ? 50 : 10 }, (_, i) => ({ operationID: `${page}-${i}` })) } }
    const all = await fetchAllDeleteOperations('s10', many)
    expect(all.items.length).toBe(60)
    expect(page).toBe(2)
  })

  it('reads common fields under several names and keeps the raw item', () => {
    const r = deleteOperationRow({ operationID: 77, status: 'Completed', createdDate: '2026-11-01', deletedCount: '3', extra: 1 })
    expect(r).toMatchObject({ id: '77', status: 'Completed', createdDate: '2026-11-01', deleted: 3, requested: null })
    expect(r.raw.extra).toBe(1)
    expect(deleteOperationRow({ id: 'x', operationStatus: 'Queued' })).toMatchObject({ id: 'x', status: 'Queued' })
  })

  it('reads the documented fields of a delete operation', () => {
    const r = deleteOperationRow({
      operationID: 9, operationName: 'GDPR batch', status: 'CompletedWithErrors', deleteType: 'ContactAndAttributes', listName: 'To delete',
      expectedListCount: 12, actualListCount: 10, successCount: 9, errorCount: 1, scheduledTime: 's', startTime: 'a', endTime: 'b',
      restorableUntilDate: 'r', createdDate: 'c', createdBy: 4401,
    })
    expect(r).toMatchObject({
      id: '9', name: 'GDPR batch', status: 'CompletedWithErrors', type: 'Contacts and their data', list: 'To delete',
      requested: 10, deleted: 9, failed: 1, scheduledDate: 's', startDate: 'a', endDate: 'b', restorableUntil: 'r', createdDate: 'c', createdBy: '4401',
    })
    expect(deleteOperationRow({ deleteType: 'AttributesOnly', expectedListCount: 5 })).toMatchObject({ type: 'Data only', requested: 5 })
  })

  it('totals the deletion summary by status', () => {
    expect(deleteSummaryTotals({
      startDateUtc: 'f', endDateUtc: 't',
      totaltimeseries: [{ requestcount: 3 }, { requestCount: 2 }],
      statustimeseries: [{ status: 'Completed', requestcount: 4 }, { Status: 'Processing', requestcount: 1 }],
    })).toEqual({ total: 5, byStatus: [{ status: 'Completed', count: 4 }, { status: 'Processing', count: 1 }], from: 'f', to: 't' })
    expect(deleteSummaryTotals({})).toEqual({ total: 0, byStatus: [], from: '', to: '' })
  })

  it('asks for an operation status with the ID encoded', async () => {
    let url
    await fetchDeleteStatus('s10', 'a b', async (u) => { url = u; return {} })
    expect(url).toMatch(/actions\/delete\/status\?operationID=a%20b$/)
  })

  it('treats a 403 on the summary as a missing permission', async () => {
    const refuse = async () => { const e = new Error('SFMC API error 403: Account / User not authorized for operation.'); e.status = 403; throw e }
    expect(await fetchDeleteSummary('s10', refuse)).toEqual({ notAuthorized: true })
    let url
    expect(await fetchDeleteSummary('s10', async (u) => { url = u; return { total: 2 } }, { days: 30, now: Date.UTC(2026, 10, 17) })).toEqual({ summary: { total: 2 } })
    expect(url).toMatch(/deleterequests\/summary\?startdateutc=2026-10-18T00%3A00%3A00.000Z&enddateutc=2026-11-17T00%3A00%3A00.000Z$/)
    await expect(fetchDeleteSummary('s10', async () => { throw new Error('SFMC API error 500: boom') })).rejects.toThrow(/500/)
  })
})
