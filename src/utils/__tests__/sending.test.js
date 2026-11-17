import { describe, it, expect } from 'vitest'
import { parseRetrieve, soapRetrieveAll } from '../soapApi.js'
import { retrieveEnvelope, soapRetrieve, SOAP_OBJECTS } from '../../background/soap.js'
import { fetchTriggeredSends, triggeredSendFlags, fetchUsers, userFlags, sendRow, fetchTmsMessage } from '../messagingApi.js'
import { ensEventInfo, ENS_EVENT_GROUPS } from '../../data/ensEvents.js'

const resp = (status, results, requestId = 'a1b2c3d4-0000-0000-0000-000000000001') => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body><RetrieveResponseMsg xmlns="http://exacttarget.com/wsdl/partnerAPI"><OverallStatus>${status}</OverallStatus><RequestID>${requestId}</RequestID>${results}</RetrieveResponseMsg></soap:Body></soap:Envelope>`

describe('SOAP reads (2026-11-10)', () => {
  it('builds only Retrieve envelopes for allowed objects, with escaped values', () => {
    const x = retrieveEnvelope({ stack: 's10', objectType: 'Send', properties: ['ID', 'bad prop', 'Email.ID'], filter: { property: 'ID', operator: 'equals', values: ['1<2'] } }, 'TOKEN')
    expect(x).toContain('<a:Action s:mustUnderstand="1">Retrieve</a:Action>')
    expect(x).toContain('https://webservice.s10.exacttarget.com/Service.asmx')
    expect(x).toContain('<Properties>ID</Properties><Properties>Email.ID</Properties>')
    expect(x).not.toContain('bad prop')
    expect(x).toContain('<Value>1&lt;2</Value>')
    expect(x).toContain('<fueloauth xmlns="http://exacttarget.com">TOKEN</fueloauth>')
    expect(() => retrieveEnvelope({ stack: 's10', objectType: 'DataExtensionObject', properties: [] }, 't')).toThrow(/not supported/)
    for (const o of ['Subscriber', 'ListSubscriber', 'List', 'BounceEvent', 'UnsubEvent', 'SentEvent', 'SuppressionListDefinition', 'SuppressionListContext']) expect(SOAP_OBJECTS.has(o)).toBe(true)
    // Retrieve only: the allowlist names object types, never actions, and every envelope is a Retrieve.
    expect(retrieveEnvelope({ stack: 's10', objectType: 'SuppressionListContext', properties: ['Definition.ObjectID'] }, 't')).toContain('<a:Action s:mustUnderstand="1">Retrieve</a:Action>')
    expect(() => retrieveEnvelope({ stack: 's10', objectType: 'SuppressionListMember', properties: [] }, 't')).toThrow(/not supported/)
    expect(() => retrieveEnvelope({ stack: 'evil.com/x', objectType: 'Send' }, 't')).toThrow(/stack/)
    expect(() => retrieveEnvelope({ stack: 's10', objectType: 'Send', filter: { property: 'ID', operator: 'DROP' } }, 't')).toThrow(/filter/)
    expect(SOAP_OBJECTS.has('Send')).toBe(true)
    const all = retrieveEnvelope({ stack: 's10', objectType: 'AccountUser', properties: ['ID'], queryAllAccounts: true }, 't')
    expect(all).toContain('<QueryAllAccounts>true</QueryAllAccounts>')
  })

  it('retries once with a renewed token when SFMC refuses it', async () => {
    let renewed = 0
    const fetch = async (url, init) => ({ ok: true, status: 200, text: async () => (init.body.includes('T1') ? 'Login failed' : resp('OK', '')) })
    const x = await soapRetrieve({ stack: 's10', objectType: 'Send', properties: ['ID'] }, { fetch, token: async () => 'T1', renew: async () => { renewed++; return 'T2' }, endpoint: async () => null })
    expect(x).toContain('<OverallStatus>OK')
    expect(renewed).toBe(1)
  })

  it('parses results and follows MoreDataAvailable pages', async () => {
    const pages = [resp('MoreDataAvailable', '<Results xsi:type="Send"><ID>1</ID><Email><ID>9</ID></Email></Results>'), resp('OK', '<Results xsi:type="Send"><ID>2</ID><Subject xsi:nil="true" /></Results>')]
    const calls = []
    const rows = await soapRetrieveAll('s10', 'Send', ['ID'], { retrieve: async (r) => { calls.push(r); return pages.shift() } })
    expect(rows).toEqual([{ ID: '1', Email: { ID: '9' } }, { ID: '2', Subject: null }])
    expect(calls[1].continueRequest).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    await expect(soapRetrieveAll('s10', 'Send', ['ID'], { retrieve: async () => resp('Error: Conversion failed', '') })).rejects.toThrow(/Conversion failed/)
    expect(() => parseRetrieve('<html>login</html>')).toThrow(/not a SOAP response/)
  })
})

describe('Triggered sends, users, sends', () => {
  it('joins definitions and their counts, and flags queues and errors', async () => {
    const retrieve = async (r) => (r.objectType === 'TriggeredSendDefinition'
      ? resp('OK', '<Results><CustomerKey>k1</CustomerKey><Name>Welcome</Name><TriggeredSendStatus>Active</TriggeredSendStatus><Email><ID>5</ID></Email></Results><Results><CustomerKey>k2</CustomerKey><Name>Old</Name><TriggeredSendStatus>Inactive</TriggeredSendStatus></Results>')
      : resp('OK', '<Results><CustomerKey>k1</CustomerKey><Sent>10</Sent><Queued>3</Queued><NotSentDueToError>1</NotSentDueToError></Results>'))
    const list = await fetchTriggeredSends('s10', { retrieve })
    expect(list[0]).toMatchObject({ key: 'k1', name: 'Welcome', sent: 10, queued: 3, notSentError: 1, emailId: 5 })
    expect(list[1].sent).toBe(null)
    expect(triggeredSendFlags(list[0])).toEqual(['3 queued', '1 not sent (error)'])
  })

  it('reads users across business units with their named roles', async () => {
    let req
    const retrieve = async (r) => { req = r; return resp('OK', '<Results><ID>7</ID><Name>Pat</Name><ActiveFlag>true</ActiveFlag><IsAPIUser>false</IsAPIUser><LastSuccessfulLogin>0001-01-01T00:00:00</LastSuccessfulLogin><Roles><Role><Name>Individual role for 7</Name><IsPrivate>true</IsPrivate></Role><Role><Name>Administrator</Name><IsPrivate>false</IsPrivate></Role></Roles></Results>') }
    const [u] = await fetchUsers('s10', { retrieve })
    expect(req.queryAllAccounts).toBe(true)
    expect(u).toMatchObject({ id: 7, name: 'Pat', active: true, apiUser: false, lastLogin: '', roles: ['Administrator'] })
    expect(userFlags(u)).toEqual(['Never logged in'])
    const now = Date.parse('2026-11-10T00:00:00Z')
    expect(userFlags({ active: true, apiUser: false, lastLogin: '2026-06-01T00:00:00Z' }, now)[0]).toMatch(/No login for 162 days/)
    expect(userFlags({ active: true, apiUser: true, lastLogin: '' }, now)).toEqual([])
  })

  it('reads a send row', () => {
    expect(sendRow({ ID: '827697', NumberSent: '2', NumberDelivered: '2', HardBounces: '0', Status: 'Complete' })).toMatchObject({ jobId: 827697, sent: 2, delivered: 2, status: 'Complete' })
  })

  it('says plainly when a message key is unknown', async () => {
    const fetch = async () => { const e = new Error('SFMC API error 500: Internal Server Error'); e.status = 500; throw e }
    await expect(fetchTmsMessage('s10', 'email', 'nope', fetch)).rejects.toThrow(/no message with this key/)
  })

  it('knows the documented ENS types', () => {
    expect(ensEventInfo('TransactionalSendEvents.EmailSent').group).toBe('Transactional email')
    expect(ensEventInfo('SendEvents.AutomationInstanceErrored')).toBeTruthy()
    expect(ensEventInfo('Made.Up')).toBe(null)
    expect(ENS_EVENT_GROUPS.flatMap((g) => g.events).length).toBe(33)
  })
})
