import { describe, it, expect, beforeEach } from 'vitest'
import {
  fetchBusinessUnits, businessUnitTree, findBusinessUnit, retrieveProps, businessUnitName, useBusinessUnits, clearBusinessUnitCache, accountTypeLabel,
  fetchSendSettings, classificationTypeLabel, senderProfileFlags, looksLikeMarketing,
  parseSfmcDate, durationSeconds, formatDuration, fetchImportResults, importResultFlags, daysAgoIso,
} from '../setupApi.js'
import { retrieveEnvelope } from '../../background/soap.js'

const resp = (results, status = 'OK') => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><RetrieveResponseMsg xmlns="http://exacttarget.com/wsdl/partnerAPI"><OverallStatus>${status}</OverallStatus><RequestID>r1</RequestID>${results}</RetrieveResponseMsg></soap:Body></soap:Envelope>`
const bu = (id, name, parent, parentName = '') => `<Results><ID>${id}</ID><Name>${name}</Name><ParentID>${parent}</ParentID><ParentName>${parentName}</ParentName><IsActive>1</IsActive><AccountType>ENTERPRISE_2</AccountType></Results>`

describe('Business units', () => {
  beforeEach(() => clearBusinessUnitCache())

  it('reads every BU across the account and orders them as a tree', async () => {
    const calls = []
    const retrieve = async (r) => { calls.push(r); return resp(bu(100, 'Enterprise', 0) + bu(300, 'Zeta', 100, 'Enterprise') + bu(200, 'Alpha', 100, 'Enterprise') + bu(210, 'Alpha child', 200, 'Alpha')) }
    const list = await fetchBusinessUnits('s10', { retrieve })
    expect(calls[0]).toMatchObject({ objectType: 'BusinessUnit', queryAllAccounts: true, filter: { property: 'ID', operator: 'greaterThan', values: ['0'] } })
    expect(list[0]).toMatchObject({ mid: 100, name: 'Enterprise', parentId: 0, active: true, accountType: 'ENTERPRISE_2' })
    expect(businessUnitTree(list).map((b) => [b.name, b.depth])).toEqual([['Enterprise', 0], ['Alpha', 1], ['Alpha child', 2], ['Zeta', 1]])
    expect(accountTypeLabel('ENTERPRISE_2')).toBe('Enterprise 2')
    // The envelope accepts the property list and filter.
    expect(retrieveEnvelope({ ...calls[0], stack: 's10' }, 't')).toContain('<Properties>AccountType</Properties>')
  })

  it('caches the list per stack and names a MID', async () => {
    let n = 0
    const retrieve = async () => { n++; return resp(bu(100, 'Enterprise', 0) + bu(200, 'Alpha', 100)) }
    expect(await businessUnitName('s10', 200, { retrieve })).toBe('Alpha')
    expect(await businessUnitName('s10', '100', { retrieve })).toBe('Enterprise')
    expect(await businessUnitName('s10', 999, { retrieve })).toBe('')
    expect(n).toBe(1)
    const b = useBusinessUnits()
    expect(b.nameFor('s10', 200)).toBe('Alpha')
    expect(b.units('s7')).toBe(null)
  })
})

describe('Send settings', () => {
  it('labels classification types and flags sender profiles and odd transactional uses', async () => {
    expect(classificationTypeLabel('Marketing')).toBe('Commercial')
    expect(classificationTypeLabel('Operational')).toBe('Transactional')
    expect(senderProfileFlags({ fromAddress: '' })).toEqual(['No From address'])
    expect(senderProfileFlags({ fromAddress: 'news@Gmail.com' })).toEqual(['Free mail domain (gmail.com)'])
    expect(senderProfileFlags({ fromAddress: 'news@brand.com' })).toEqual([])
    expect(looksLikeMarketing('Spring_Promo_2026')).toBe(true)
    expect(looksLikeMarketing('Password reset')).toBe(false)

    const retrieve = async (r) => {
      if (r.objectType === 'SendClassification') return resp('<Results><ObjectID>c1</ObjectID><CustomerKey>Default Transactional</CustomerKey><Name>Default Transactional</Name><SendClassificationType>Operational</SendClassificationType><SenderProfile><CustomerKey>sp1</CustomerKey></SenderProfile><DeliveryProfile><CustomerKey>Default</CustomerKey></DeliveryProfile></Results><Results><CustomerKey>Default Commercial</CustomerKey><Name>Default Commercial</Name><SendClassificationType>Marketing</SendClassificationType><SenderProfile><CustomerKey>sp2</CustomerKey></SenderProfile></Results>')
      if (r.objectType === 'SenderProfile') return resp('<Results><ObjectID>p1</ObjectID><CustomerKey>sp1</CustomerKey><Name>Brand</Name><FromName>Brand</FromName><FromAddress>hello@brand.com</FromAddress></Results><Results><CustomerKey>sp2</CustomerKey><Name>Personal</Name><FromAddress>me@yahoo.com</FromAddress></Results>')
      if (r.objectType === 'PrivateIP') {
        expect(r.properties).toEqual(['ID', 'Name', 'IPAddress', 'IsActive', 'OrdinalID'])
        return resp('<Results><ID>2</ID><Name>Backup</Name><IPAddress>13.111.0.2</IPAddress><IsActive>false</IsActive><OrdinalID>2</OrdinalID></Results><Results><ID>1</ID><Name>Main</Name><IPAddress>13.111.0.1</IPAddress><IsActive>true</IsActive><OrdinalID>1</OrdinalID></Results>')
      }
      throw new Error('unexpected ' + r.objectType)
    }
    const triggered = async () => [
      { key: 't1', name: 'Weekly newsletter', status: 'Active', sendClassification: 'Default Transactional' },
      { key: 't2', name: 'Order confirmation', status: 'Active', sendClassification: 'Default Transactional' },
      { key: 't3', name: 'Old promo', status: 'Deleted', sendClassification: 'Default Transactional' },
    ]
    const tms = async () => [{ definitionKey: 'd1', name: 'Receipt', status: 'Active', classification: 'Default Transactional' }]
    const s = await fetchSendSettings('s10', { retrieve, triggered, tms, fetch: () => {} })
    const [tx, com] = s.classifications
    expect(tx).toMatchObject({ typeLabel: 'Transactional', deliveryProfileKey: 'Default', usedBy: 3 })
    expect(tx.profile.fromAddress).toBe('hello@brand.com')
    expect(tx.triggered.map((t) => t.key)).toEqual(['t1', 't2'])
    expect(tx.flags[0]).toMatch(/Weekly newsletter/)
    expect(com.flags).toEqual([])
    expect(s.profiles.find((p) => p.key === 'sp2').flags).toEqual(['Free mail domain (yahoo.com)'])
    expect(s.profiles.find((p) => p.key === 'sp1').classificationCount).toBe(1)
    expect(s.privateIps).toEqual([
      { id: 1, name: 'Main', address: '13.111.0.1', active: true, order: 1 },
      { id: 2, name: 'Backup', address: '13.111.0.2', active: false, order: 2 },
    ])
    expect(s.notes).toEqual([])
  })

  it('keeps going when triggered or transactional reads fail', async () => {
    const retrieve = async () => resp('')
    const s = await fetchSendSettings('s10', { retrieve, triggered: async () => { throw new Error('nope') }, tms: async () => { throw new Error('x') }, fetch: () => {} })
    expect(s.classifications).toEqual([])
    expect(s.privateIps).toEqual([])
    expect(s.notes.length).toBe(2)
  })

  // Feedback #1077: an unreadable IP list is a note, not a failure of the page.
  it('notes IP addresses it could not read', async () => {
    const retrieve = async (r) => (r.objectType === 'PrivateIP' ? resp('', 'Error: not allowed') : resp(''))
    const s = await fetchSendSettings('s10', { retrieve, triggered: async () => [], tms: async () => [], fetch: () => {} })
    expect(s.privateIps).toBeNull()
    expect(s.notes.join(' ')).toMatch(/IP addresses could not be read/)
  })
})

describe('Import results', () => {
  it('parses SFMC dates and durations', () => {
    expect(parseSfmcDate('9/25/2026 12:01:13 AM')).toBe('2026-09-25T00:01:13')
    expect(parseSfmcDate('9/25/2026 1:05:00 PM')).toBe('2026-09-25T13:05:00')
    expect(parseSfmcDate('12/1/2026 12:00:00 PM')).toBe('2026-12-01T12:00:00')
    expect(parseSfmcDate('2026-09-25T10:00:00.123')).toBe('2026-09-25T10:00:00')
    expect(parseSfmcDate('')).toBe('')
    expect(durationSeconds('2026-09-25T00:01:13', '2026-09-25T00:02:28')).toBe(75)
    expect(formatDuration(75)).toBe('1 min 15 s')
    expect(formatDuration(3700)).toBe('1 h 1 min')
    expect(formatDuration(null)).toBe('')
  })

  it('reads runs since a date, names them and flags problems', async () => {
    const calls = []
    const retrieve = async (r) => {
      calls.push(r)
      if (r.objectType === 'ImportResultsSummary') return resp('<Results><ImportDefinitionCustomerKey>imp1</ImportDefinitionCustomerKey><ImportStatus>Completed</ImportStatus><StartDate>9/25/2026 12:01:13 AM</StartDate><EndDate>9/25/2026 12:01:43 AM</EndDate><TotalRows>10</TotalRows><NumberSuccessful>8</NumberSuccessful><NumberErrors>2</NumberErrors><ImportType>Data Extension</ImportType><ObjectID>o1</ObjectID></Results><Results><ImportDefinitionCustomerKey>imp1</ImportDefinitionCustomerKey><ImportStatus>Completed</ImportStatus><StartDate>9/26/2026 12:01:13 AM</StartDate><EndDate>9/26/2026 12:01:14 AM</EndDate><TotalRows>5</TotalRows><NumberErrors>0</NumberErrors><ObjectID>o2</ObjectID></Results>')
      return resp('<Results><CustomerKey>imp1</CustomerKey><Name>Daily members</Name></Results>')
    }
    const now = Date.parse('2026-10-01T00:00:00Z')
    const rows = await fetchImportResults('s10', { days: 30, now, retrieve })
    expect(calls[0].filter).toEqual({ property: 'StartDate', operator: 'greaterThan', values: [daysAgoIso(30, now)], dates: true })
    expect(calls[1].filter).toEqual({ property: 'CustomerKey', operator: 'equals', values: ['imp1'] })
    expect(rows.map((r) => r.id)).toEqual(['o2', 'o1'])
    expect(rows[1]).toMatchObject({ name: 'Daily members', total: 10, successful: 8, errors: 2, durationSec: 30, importType: 'Data Extension' })
    expect(importResultFlags(rows[1])).toEqual(['2 errors'])
    expect(importResultFlags({ status: 'Error', errors: 0 })).toEqual(['Status Error'])
    expect(importResultFlags(rows[0])).toEqual([])
    // The envelope for the filtered request builds.
    expect(retrieveEnvelope({ stack: 's10', ...calls[0] }, 't')).toContain('<DateValue>')
  })

  it('filters by import definition key for one activity', async () => {
    const calls = []
    const retrieve = async (r) => { calls.push(r); return resp('') }
    await fetchImportResults('s10', { key: 'imp1', days: 90, retrieve })
    expect(calls[0].filter.logical).toBe('AND')
    expect(calls[0].filter.left).toEqual({ property: 'ImportDefinitionCustomerKey', operator: 'equals', values: ['imp1'] })
    expect(retrieveEnvelope({ stack: 's10', ...calls[0] }, 't')).toContain('ComplexFilterPart')
    expect(calls.length).toBe(1) // no names to look up
  })
})

describe('Business unit lookup and property fallback', () => {
  it('finds a MID and its path from the top', () => {
    const list = [{ mid: 100, name: 'Enterprise', parentId: 0 }, { mid: 200, name: 'Alpha', parentId: 100 }, { mid: 210, name: 'Alpha child', parentId: 200 }]
    const hit = findBusinessUnit(list, ' 210 ')
    expect(hit.unit.name).toBe('Alpha child')
    expect(hit.path.map((b) => b.name)).toEqual(['Enterprise', 'Alpha', 'Alpha child'])
    expect(findBusinessUnit(list, '999')).toEqual({ unit: null, path: [] })
    expect(findBusinessUnit(list, 'abc').unit).toBe(null)
  })

  it('reads again with the checked properties when SFMC refuses one', async () => {
    const asked = []
    const retrieve = async (r) => {
      asked.push(r.properties)
      return r.properties.includes('Extra')
        ? resp('', 'Error: The Request Property(s) Extra do not match with the fields of SenderProfile retrieve')
        : resp('<Results><Name>A</Name></Results>')
    }
    const rows = await retrieveProps('s10', 'SenderProfile', ['Name', 'Extra'], ['Name'], { retrieve })
    expect(rows).toEqual([{ Name: 'A' }])
    expect(asked).toEqual([['Name', 'Extra'], ['Name']])
    // Other errors are not retried.
    const fail = async () => resp('', 'Error: Not authorized')
    await expect(retrieveProps('s10', 'SenderProfile', ['Name', 'Extra'], ['Name'], { retrieve: fail })).rejects.toThrow(/Not authorized/)
  })
})
