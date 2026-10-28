import { describe, it, expect, vi, beforeEach } from 'vitest'

const sfmcFetch = vi.fn()
vi.mock('../sfmcApi.js', () => ({ sfmcFetch: (...a) => sfmcFetch(...a) }))
const { fetchStorageDetails, fetchStorageHistory, byBusinessUnit, mdY, formatGB, storageDetailsCsv, storageFailureNotice, PARENT_BU_ONLY } = await import('../storageApi.js')

beforeEach(() => sfmcFetch.mockReset())

describe('data extension storage (feedback #68)', () => {
  it('reads storage details', async () => {
    sfmcFetch.mockResolvedValue({ count: 2, items: [
      { mID: 1, businessUnitName: 'Main', dataExtensionName: 'Transaction_Data', dataExtensionPath: 'Data Extensions/Player Data', recordCount: 8732221791, usedGB: 520.79534, dataRetentionPolicy: 'Off', externalKey: 'K1', type: 'Custom', sampleDate: '2026-10-21' },
      { mID: 2, businessUnitName: 'Child', dataExtensionName: 'Small', recordCount: 10, usedGB: 0.001 },
    ] })
    const r = await fetchStorageDetails('s4')
    expect(sfmcFetch.mock.calls[0][0]).toBe('https://mc-data-ui.s4.marketingcloudapps.com/fuelapi/data/v1/customobjects/storageDetails')
    expect(r.items[0]).toMatchObject({ key: 'K1', name: 'Transaction_Data', rows: 8732221791, gb: 520.79534, retention: 'Off', businessUnit: 'Main' })
    expect(byBusinessUnit(r.items).map((b) => b.businessUnit)).toEqual(['Main', 'Child'])
    const csv = storageDetailsCsv(r.items).split('\r\n')
    expect(csv[0]).toContain('"GB"')
    expect(csv[1]).toContain('"Transaction_Data"')
    expect(csv[1]).toContain('"520.79534"')
  })
  it('reads the history between two MM-DD-YYYY dates, oldest first', async () => {
    sfmcFetch.mockResolvedValue({ items: [{ date: '2026-10-21T06:00:00Z', totalGB: 573, totalRowCount: 9, count: 2298 }, { date: '2026-09-21T06:00:00Z', totalGB: 570 }] })
    const h = await fetchStorageHistory('s4', 30, new Date(2026, 9, 22))
    expect(sfmcFetch.mock.calls[0][0]).toBe('https://mc-data-ui.s4.marketingcloudapps.com/fuelapi/data/v1/customobjects/storageHistory?startDate=09-22-2026&endDate=10-22-2026')
    expect(h.map((d) => d.key)).toEqual(['2026-09-21', '2026-10-21'])
    expect(mdY(new Date(2026, 0, 5))).toBe('01-05-2026')
    expect([520.7, 3.21, 0.004, 0].map(formatGB)).toEqual(['521', '3.2', '<0.01', '0'])
  })
})

describe('SFMC error pages (fetchProxy errorText)', () => {
  it('turns an HTML error page into its title and leaves other text alone', async () => {
    const { errorText } = await import('../../background/fetchProxy.js')
    expect(errorText('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0"><html><head><title>Not Authorized</title></head><body><h1>403</h1></body></html>')).toBe('Not Authorized')
    expect(errorText('<html><body><h1><span>403</span> Forbidden</h1></body></html>')).toBe('403 Forbidden')
    expect(errorText('{"message":"x"}')).toBe('{"message":"x"}')
  })
})

describe('storage from a child BU (feedback #125)', () => {
  it('tells a child BU to switch to the parent and keeps the raw error', () => {
    const r = storageFailureNotice(new Error('403 Forbidden'), { name: 'Acme Child', isChild: true })
    expect(r.childBU).toBe(true)
    expect(r.notice).toMatch(/"Acme Child", a child business unit/)
    expect(r.notice).toContain(PARENT_BU_ONLY)
    expect(r.detail).toBe('403 Forbidden')
  })
  it('in the parent BU, points at Contact Builder instead', () => {
    const r = storageFailureNotice(new Error('500'), { name: 'Acme', isChild: false })
    expect(r.childBU).toBe(false)
    expect(r.notice).not.toMatch(/child/)
  })
  it('when the BU is unknown, names both causes', () => {
    const r = storageFailureNotice('boom', null)
    expect(r.childBU).toBeNull()
    expect(r.notice).toMatch(/parent \(Enterprise\) business unit/)
    expect(r.detail).toBe('boom')
  })
})
