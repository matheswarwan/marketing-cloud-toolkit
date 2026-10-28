import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectDelimiter, parseDelimited, parseDelimitedSample, parseJsonSample, parseParquetSample, guessField,
  fieldsFromSample, cleanFieldName, suggestTextLength, readSampleFile, parseSpreadsheetSample, MAX_SAMPLE_ROWS,
} from '../createDE/sample.js'

describe('Create DE samples (feedback #94)', () => {
  it('detects comma, tab, semicolon and pipe', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a;b\n"1,5";2')).toBe(';')
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|')
  })

  it('reads quoted cells with separators, doubled quotes and line breaks, a BOM and CRLF', () => {
    const { rows } = parseDelimited('﻿Name,Note\r\n"Smith, J","said ""hi""\r\nthen left"\r\nLee,\r\n', ',')
    expect(rows).toEqual([['Name', 'Note'], ['Smith, J', 'said "hi"\r\nthen left'], ['Lee', '']])
  })

  it('makes header names unique and pads short rows', () => {
    const t = parseDelimitedSample('id,id,\n1,2\n')
    expect(t.columns).toEqual(['id', 'id_2', 'Column3'])
    expect(t.rows).toEqual([['1', '2', '']])
  })

  it('stops after the row limit', () => {
    const text = 'n\n' + Array.from({ length: MAX_SAMPLE_ROWS + 50 }, (_, i) => i).join('\n')
    const t = parseDelimitedSample(text)
    expect(t.rows).toHaveLength(MAX_SAMPLE_ROWS)
    expect(t.truncated).toBe(true)
  })

  it('reads a JSON array of objects', () => {
    const t = parseJsonSample('[{"a":1,"b":true},{"a":2,"c":null}]')
    expect(t.columns).toEqual(['a', 'b', 'c'])
    expect(t.rows).toEqual([['1', 'true', ''], ['2', '', '']])
    expect(() => parseJsonSample('[1,2]')).toThrow('array of objects')
  })

  it('guesses types from values', () => {
    expect(guessField(['1', '22', '-3'])).toMatchObject({ type: 'Number', isNullable: false })
    expect(guessField(['1.5', '22.25', ''])).toMatchObject({ type: 'Decimal', length: 18, scale: 2, isNullable: true })
    expect(guessField(['00123', '00456']).type).toBe('Text')
    expect(guessField(['14165551234', '14165551235']).type).toBe('Text')
    expect(guessField(['2026-01-02', '2026-10-23 14:05:00', '10/23/2026']).type).toBe('Date')
    expect(guessField(['true', 'No', 'Y']).type).toBe('Boolean')
    expect(guessField(['a@b.co', 'x.y@z.org']).type).toBe('EmailAddress')
    expect(guessField(['hello', 'a'.repeat(40)])).toMatchObject({ type: 'Text', length: 100 })
    expect(guessField(['', ''])).toMatchObject({ type: 'Text', isNullable: true })
    expect(suggestTextLength(3000)).toBe(4000)
  })

  it('cleans column names into field names', () => {
    expect(cleanFieldName(' First-Name (x) ')).toBe('First_Name_x')
    expect(cleanFieldName('_hidden')).toBe('hidden')
    expect(cleanFieldName('2024 Sales')).toBe('F_2024 Sales')
    expect(cleanFieldName('***')).toBe('Field')
    const f = fieldsFromSample({ columns: ['E-mail', 'Age'], rows: [['a@b.co', '3']] })
    expect(f.map((x) => [x.name, x.sourceName, x.type])).toEqual([['E_mail', 'E-mail', 'EmailAddress'], ['Age', 'Age', 'Number']])
  })

  it('reads a Parquet file and uses its column types', async () => {
    const buf = readFileSync(join(process.cwd(), 'src/utils/__tests__/fixtures/sample.parquet'))
    const ab = new ArrayBuffer(buf.length)
    new Uint8Array(ab).set(buf)
    const t = await parseParquetSample(ab)
    expect(t.columns).toEqual(['SubscriberKey', 'Age', 'Score', 'Active', 'Joined'])
    expect(t.rows[0]).toEqual(['A1', '31', '1.5', 'true', '2026-01-02'])
    expect(t.rows[2][4]).toBe('')
    const types = fieldsFromSample(t).map((f) => f.type)
    expect(types).toEqual(['Text', 'Number', 'Decimal', 'Boolean', 'Date'])
  })

  it('reads the first sheet of an Excel workbook', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Count'], ['A', 3], ['B', 4]]), 'Data')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const t = await parseSpreadsheetSample(out)
    expect(t).toMatchObject({ columns: ['Name', 'Count'], rows: [['A', '3'], ['B', '4']], sheet: 'Data' })
  })

  it('reads uploaded text files and refuses unknown types', async () => {
    const tsv = new File(['a\tb\n1\t2\n'], 'x.tsv')
    expect(await readSampleFile(tsv)).toMatchObject({ kind: 'delimited', columns: ['a', 'b'], rows: [['1', '2']] })
    await expect(readSampleFile(new File(['x'], 'x.pdf'))).rejects.toThrow('CSV, TSV')
  })
})
