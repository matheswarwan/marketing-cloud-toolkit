import { describe, it, expect, vi } from 'vitest'
import { fieldsInOrder, moveItem, sameOrder, reorderInPlace, toCreateField, copyName, copySettings, copySql, copyInNewOrder } from '../deReorder.js'

const F = (name, ordinal, extra = {}) => ({ id: `id-${name}`, name, ordinal, type: 'Text', length: 50, isNullable: true, ...extra })

describe('fieldsInOrder and moveItem', () => {
  it('sorts by ordinal, not primary key first', () => {
    const list = [F('B', 1), F('Key', 2, { isPrimaryKey: true }), F('A', 0)]
    expect(fieldsInOrder(list).map((f) => f.name)).toEqual(['A', 'B', 'Key'])
  })
  it('moves an item and leaves the input alone', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(list, 1, 9)).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
  it('compares orders by name', () => {
    expect(sameOrder([F('A', 0), F('B', 1)], [F('A', 5), F('B', 9)])).toBe(true)
    expect(sameOrder([F('A', 0), F('B', 1)], [F('B', 0), F('A', 1)])).toBe(false)
  })
})

describe('reorderInPlace', () => {
  const de = { id: 'de1', name: 'Orders' }
  const wanted = [F('B', 1), F('A', 0)]
  it('sends every field as read with the new ordinals and reports success when SFMC has the order', async () => {
    const sfmcFetch = vi.fn().mockResolvedValue({})
    const readFieldOrder = vi.fn().mockResolvedValue([F('B', 0), F('A', 1)])
    const r = await reorderInPlace('s7', de, wanted, { sfmcFetch, readFieldOrder })
    expect(r.applied).toBe(true)
    const [url, method, body] = sfmcFetch.mock.calls[0]
    expect(url).toBe('https://mc.s7.exacttarget.com/cloud/fuelapi/internal/v1/customobjects/de1')
    expect(method).toBe('PATCH')
    expect(body.fields).toEqual([{ ...F('B', 0) }, { ...F('A', 1) }])
  })
  it('says not applied when SFMC keeps the old order', async () => {
    const r = await reorderInPlace('s7', de, wanted, { sfmcFetch: vi.fn().mockResolvedValue({}), readFieldOrder: vi.fn().mockResolvedValue([F('A', 0), F('B', 1)]) })
    expect(r).toMatchObject({ applied: false, error: '' })
  })
  it('keeps the refusal text', async () => {
    const r = await reorderInPlace('s7', de, wanted, { sfmcFetch: vi.fn().mockRejectedValue(new Error('SFMC API error 400: nope')), readFieldOrder: vi.fn().mockResolvedValue([F('A', 0), F('B', 1)]) })
    expect(r).toMatchObject({ applied: false, error: 'SFMC API error 400: nope' })
  })
})

describe('copy helpers', () => {
  it('turns read fields into Create DE fields', () => {
    expect(toCreateField({ name: 'Amount', type: 'Decimal', length: 18, scale: 2, isNullable: true })).toMatchObject({ type: 'Decimal', length: 18, scale: 2 })
    expect(toCreateField({ name: 'Email', type: 'EmailAddress', length: 254, isPrimaryKey: true, isNullable: true })).toMatchObject({ type: 'EmailAddress', length: '', isPrimaryKey: true, isNullable: false })
    expect(toCreateField({ name: 'When', type: 'Date', defaultValue: 'GETDATE()' })).toMatchObject({ currentDate: true, defaultValue: '' })
    expect(toCreateField({ name: 'N', type: 1 })).toMatchObject({ type: 'Number' })
  })
  it('names the copy within 128 characters', () => {
    expect(copyName('Orders')).toBe('Orders_Reordered')
    expect(copyName('x'.repeat(200))).toHaveLength(128)
  })
  it('takes folder, sendable and testable from the record', () => {
    const s = copySettings({ name: 'Orders', categoryId: 9 }, { categoryID: 12, isSendable: true, sendableCustomObjectField: 'Key', isTestable: true, description: 'd' })
    expect(s).toMatchObject({ name: 'Orders_Reordered', folderId: 12, isSendable: true, sendField: 'Key', isTestable: true, description: 'd' })
    expect(copySettings({ name: 'Orders', categoryId: 9 }, { isSendable: true })).toMatchObject({ folderId: 9, isSendable: false })
  })
  it('selects every column in the new order', () => {
    expect(copySql('My Orders', [F('Order Id', 0), F('Email', 1)])).toBe('SELECT [Order Id], Email\nFROM [My Orders]')
  })
})

describe('copyInNewOrder', () => {
  function fakeApi(statuses) {
    const s = [...statuses]
    return {
      fetchDEDetail: vi.fn(async (stack, id) => (id === 'de1' ? { categoryID: 5, totalRowCount: 10 } : { totalRowCount: 10 })),
      createDE: vi.fn(async () => ({ de: { id: 'new', key: 'NEWKEY', name: 'Orders_Reordered' } })),
      getOrCreateQAFolder: vi.fn(async () => 77),
      createQueryActivity: vi.fn(async () => ({ queryDefinitionId: 'qa1' })),
      startQueryActivity: vi.fn(async () => {}),
      getQueryActivityStatus: vi.fn(async () => ({ isRunning: s.length ? s.shift() : false })),
      deleteQueryActivity: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
    }
  }
  const de = { id: 'de1', name: 'Orders', categoryId: 5 }
  const order = [F('B', 1), F('A', 0)]

  it('creates the copy, runs the query activity, deletes it and compares counts', async () => {
    const api = fakeApi([true, true, false])
    const r = await copyInNewOrder('s7', de, order, { api })
    expect(api.createDE.mock.calls[0][2].map((f) => f.name)).toEqual(['B', 'A'])
    expect(api.createQueryActivity.mock.calls[0][1]).toMatchObject({ queryText: 'SELECT B, A\nFROM Orders', targetKey: 'NEWKEY', targetId: 'new', updateType: 0, categoryId: 77 })
    expect(api.getQueryActivityStatus).toHaveBeenCalledTimes(3)
    expect(api.deleteQueryActivity).toHaveBeenCalledWith('s7', 'qa1')
    expect(r).toMatchObject({ rows: 10, sourceRows: 10, activityLeft: false })
  })
  it('deletes the activity when the start fails', async () => {
    const api = fakeApi([])
    api.startQueryActivity.mockRejectedValue(new Error('no'))
    await expect(copyInNewOrder('s7', de, order, { api })).rejects.toThrow('no')
    expect(api.deleteQueryActivity).toHaveBeenCalled()
  })
  it('leaves a copy still running alone', async () => {
    const api = fakeApi(Array(50).fill(true))
    await expect(copyInNewOrder('s7', de, order, { api, maxMinutes: -1 })).rejects.toThrow(/still running/)
    expect(api.deleteQueryActivity).not.toHaveBeenCalled()
  })
})
