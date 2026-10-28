import { describe, it, expect } from 'vitest'
import {
  fieldProblem, cellProblem, checkCreateForm, isFormValid, buildCreateBody, rowsToLoad, createDE, blankSettings, LOAD_BATCH, lengthErrorField,
  buildFields, isTypeRefusal, CURRENT_DATE_DEFAULT,
} from '../createDE/createDE.js'

const f = (o) => ({ name: 'F', type: 'Text', length: 50, scale: 0, isPrimaryKey: false, isNullable: true, defaultValue: '', ...o })
const settings = (o = {}) => ({ ...blankSettings(), name: 'My DE', folderId: '101', folderPath: 'Data Extensions > Reports', ...o })

describe('Create DE rules (feedback #94)', () => {
  it('checks field names, lengths, keys and defaults', () => {
    expect(fieldProblem(f({ name: '' }))).toBe('Enter a name.')
    expect(fieldProblem(f({ name: 'a-b' }))).toContain('letters, numbers')
    expect(fieldProblem(f({ name: '_x' }))).toContain('underscore')
    expect(fieldProblem(f({ name: 'A' }), [f({ name: 'A' }), f({ name: 'a' })])).toBe('Two fields have this name.')
    expect(fieldProblem(f({ length: 5000 }))).toContain('1 to 4000')
    expect(fieldProblem(f({ type: 'Decimal', length: 10, scale: 12 }))).toContain('Decimal places')
    expect(fieldProblem(f({ isPrimaryKey: true, isNullable: true }))).toContain('must be required')
    expect(fieldProblem(f({ type: 'Number', length: null, defaultValue: 'x' }))).toContain('Default value')
    expect(fieldProblem(f({ type: 'Number', length: null, defaultValue: '5' }))).toBe('')
  })

  it('flags sample values that do not fit', () => {
    expect(cellProblem('', f({ isNullable: false }))).toBe('Required')
    expect(cellProblem('', f({ isNullable: false, defaultValue: 'x' }))).toBe('')
    expect(cellProblem('abcdef', f({ length: 3 }))).toContain('Longer than 3')
    expect(cellProblem('1.5', f({ type: 'Number' }))).toBe('Not a whole number')
    expect(cellProblem('12.345', f({ type: 'Decimal', length: 18, scale: 2 }))).toContain('decimal places')
    expect(cellProblem('123456', f({ type: 'Decimal', length: 6, scale: 2 }))).toBe('Too many digits')
    expect(cellProblem('nope', f({ type: 'Date' }))).toBe('Not a date')
    expect(cellProblem('a@b', f({ type: 'EmailAddress' }))).toBe('Not an email address')
    expect(cellProblem('en-US', f({ type: 'Locale' }))).toBe('')
  })

  it('checks the settings', () => {
    const fields = [f({ name: 'Email', type: 'EmailAddress' })]
    expect(checkCreateForm(settings({ name: '', folderId: null }), fields).form).toEqual(['Enter a name for the data extension.', 'Pick a folder.'])
    expect(checkCreateForm(settings({ key: 'has space' }), fields).form[0]).toContain('external key')
    expect(checkCreateForm(settings({ isSendable: true }), fields).form[0]).toContain('Subscriber Key')
    expect(checkCreateForm(settings({ retention: { mode: 'rows', length: 0, unit: 3 } }), fields).form[0]).toContain('1 to 999')
    expect(isFormValid(checkCreateForm(settings({ isSendable: true, sendField: 'Email' }), fields))).toBe(true)
  })

  it('builds the request with sendable, retention, key and field shapes', () => {
    const body = buildCreateBody(settings({
      key: 'MY_KEY', description: ' d ', isSendable: true, sendField: 'SubKey', isTestable: true,
      retention: { mode: 'allAndDE', length: 6, unit: 5, resetOnImport: true },
    }), [
      f({ name: 'SubKey', length: 254, isPrimaryKey: true, isNullable: false }),
      f({ name: 'Notes', length: '' }),
      f({ name: 'Amount', type: 'Decimal', length: 12, scale: 2, defaultValue: '0' }),
      f({ name: 'Email', type: 'EmailAddress', length: null }),
      f({ name: 'Lang', type: 'Locale', length: null }),
    ])
    expect(body).toMatchObject({
      name: 'My DE', customerKey: 'MY_KEY', description: 'd', categoryID: 101, isSendable: true, isTestable: true,
      sendableCustomObjectField: 'SubKey', sendableSubscriberField: '_SubscriberKey',
      dataRetentionProperties: { isRowBasedRetention: false, isDeleteAtEndOfRetentionPeriod: true, isResetRetentionPeriodOnImport: true, dataRetentionPeriodLength: 6, dataRetentionPeriodUnitOfMeasure: 5 },
    })
    // Contact Builder's own shape (user's capture, 2026-10-25).
    expect(body.fields.map((x) => [x.name, x.type, x.length, x.scale, x.isPrimaryKey, x.isNullable])).toEqual([
      ['SubKey', 0, 254, 0, true, false],
      ['Notes', 0, 4000, 0, false, true],
      ['Amount', 6, 12, 2, false, true],
      ['Email', 4, 254, 0, false, true],
      ['Lang', 7, null, 0, false, true],
    ])
    expect(body.fields[3].defaultValue).toBe(null)
    expect(body.fields[2].defaultValue).toBe('0')
    expect(buildCreateBody(settings(), [f()])).not.toHaveProperty('dataRetentionProperties')
    expect(buildCreateBody(settings(), [f()])).not.toHaveProperty('customerKey')
  })

  it('maps sample rows to fields, leaving out rows that do not fit', () => {
    const fields = [f({ name: 'Id', type: 'Number', isNullable: false }), f({ name: 'Ok', type: 'Boolean' }), f({ name: 'Extra' })]
    const { items, skipped } = rowsToLoad(fields, [['1', 'yes'], ['x', 'no'], ['3', '']], [0, 1, null])
    expect(items).toEqual([{ Id: '1', Ok: 'true' }, { Id: '3' }])
    expect(skipped).toBe(1)
  })

  it('creates, then adds rows in batches', async () => {
    const calls = []
    const api = {
      createDataExtension: async (s, body) => { calls.push(['create', body.name]); return { id: 'D1', customerKey: 'K1' } },
      insertDERowsAsync: async (s, key, items) => { calls.push(['rows', key, items.length]) },
    }
    const rows = Array.from({ length: LOAD_BATCH + 10 }, (_, i) => [String(i)])
    const out = await createDE('s13', settings(), [f({ name: 'N', type: 'Number' })], { rows, columnIndex: [0], api })
    expect(calls).toEqual([['create', 'My DE'], ['rows', 'K1', LOAD_BATCH], ['rows', 'K1', 10]])
    expect(out).toMatchObject({ de: { id: 'D1', key: 'K1', name: 'My DE' }, loaded: LOAD_BATCH + 10, skipped: 0, loadError: '' })
  })

  it('keeps the created DE when adding rows fails, and refuses an invalid form', async () => {
    const api = {
      createDataExtension: async () => ({ id: 'D1', customerKey: 'K1' }),
      insertDERowsAsync: async () => { throw new Error('SFMC API error 400: bad row') },
    }
    const out = await createDE('s13', settings(), [f()], { rows: [['a']], columnIndex: [0], api })
    expect(out.loadError).toContain('bad row')
    await expect(createDE('s13', settings({ name: '' }), [f()], { api })).rejects.toThrow('Enter a name')
  })
})

describe('SFMC length error (feedback #131)', () => {
  it('names the field SFMC refused', () => {
    expect(lengthErrorField('SFMC API error 400: {"message":"Length is invalid for field email because it does not have a data type of Text.","errorcode":10000}')).toBe('email')
    expect(lengthErrorField('SFMC API error 400: something else')).toBeNull()
    expect(lengthErrorField('')).toBeNull()
  })
})

describe('numeric field types, type names on retry', () => {
  const email = f({ name: 'EmailAddress', type: 'EmailAddress', length: null })
  it('builds the type-name shape on request', () => {
    expect(buildFields([email, f({ name: 'N', type: 'Number' })], { named: true }).map((x) => [x.type, x.scale, x.length]))
      .toEqual([['EmailAddress', undefined, undefined], ['Number', undefined, undefined]])
    expect(buildFields([email, f({ name: 'N', type: 'Number' })]).map((x) => [x.type, x.scale, x.length]))
      .toEqual([[4, 0, 254], [1, 0, null]])
  })
  it('tells a type refusal from the length error', () => {
    expect(isTypeRefusal('SFMC API error 400: {"message":"Invalid field type EmailAddress"}')).toBe(true)
    expect(isTypeRefusal('SFMC API error 400: {"message":"Length is invalid for field EmailAddress because it does not have a data type of Text."}')).toBe(false)
    expect(isTypeRefusal('SFMC API error 400: name taken')).toBe(false)
  })
  it('retries once with type names when SFMC refuses the numeric types', async () => {
    const sent = []
    const api = {
      createDataExtension: async (s, body) => {
        sent.push(body.fields[0].type)
        if (typeof body.fields[0].type === 'number') throw new Error('SFMC API error 400: {"message":"Unknown field type"}')
        return { id: 'D1', customerKey: 'K1' }
      },
      insertDERowsAsync: async () => {},
    }
    const out = await createDE('s13', settings(), [email], { api })
    expect(sent).toEqual([4, 'EmailAddress'])
    expect(out.de.id).toBe('D1')
  })
  it('does not retry other refusals', async () => {
    let n = 0
    const api = { createDataExtension: async () => { n++; throw new Error('SFMC API error 400: {"message":"Length is invalid for field EmailAddress because it does not have a data type of Text."}') } }
    await expect(createDE('s13', settings(), [email], { api })).rejects.toThrow('Length is invalid')
    expect(n).toBe(1)
  })
})

describe('Current date default (feedback #133)', () => {
  it('sends the current date default and accepts empty cells', () => {
    const d = f({ name: 'Added', type: 'Date', length: null, isNullable: false, currentDate: true, defaultValue: 'ignored' })
    expect(buildFields([d])[0].defaultValue).toBe(CURRENT_DATE_DEFAULT)
    expect(fieldProblem(d)).toBe('')
    expect(cellProblem('', d)).toBe('')
    expect(buildFields([f({ name: 'T', currentDate: true })])[0].defaultValue).toBe(null)
  })
})
