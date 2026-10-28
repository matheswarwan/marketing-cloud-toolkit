import { describe, it, expect, vi } from 'vitest'
vi.mock('../sfmcApi.js', () => ({ insertDERowsAsync: vi.fn(), upsertDERowsAsync: vi.fn(), createTargetDE: vi.fn() }))
import { mapRows, saveResultsToDE } from '../saveResults.js'

describe('Save results to a data extension', () => {
  it('maps lower-case result keys to the target fields and lists the others', () => {
    expect(mapRows([{ subscriberkey: 'a', extra: 1, email: null }], [{ name: 'SubscriberKey' }, { name: 'Email' }]))
      .toEqual({ items: [{ SubscriberKey: 'a', Email: '' }], dropped: ['extra'] })
  })
  it('sends 500 rows at a time, upsert or insert, creating the DE first when asked', async () => {
    const api = { insertDERowsAsync: vi.fn(async () => ({})), upsertDERowsAsync: vi.fn(async () => ({})), createTargetDE: vi.fn(async () => ({ id: 'd1', customerKey: 'K1' })) }
    const rows = Array.from({ length: 1201 }, (_, i) => ({ k: i }))
    const r = await saveResultsToDE('s7', { create: { name: 'New', categoryID: 5, fields: [{ name: 'K' }] }, rows, mode: 'upsert' }, api)
    expect(api.createTargetDE).toHaveBeenCalledWith('s7', { name: 'New', fields: [{ name: 'K' }], categoryID: 5 })
    expect(api.upsertDERowsAsync).toHaveBeenCalledTimes(3)
    expect(api.upsertDERowsAsync.mock.calls[2][2]).toHaveLength(201)
    expect(r).toMatchObject({ sent: 1201, de: { key: 'K1', created: true } })
    await saveResultsToDE('s7', { target: { key: 'X', fields: [{ name: 'K' }] }, rows: [{ k: 1 }] }, api)
    expect(api.insertDERowsAsync).toHaveBeenCalledWith('s7', 'X', [{ K: 1 }])
  })
})
