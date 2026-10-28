import { describe, it, expect } from 'vitest'
import { parseCSV, queriesToCsv, csvToQueryRecords, csvFileName } from '../queryCsv.js'

describe('query CSV', () => {
  it('round-trips names and SQL with commas, quotes and newlines', () => {
    const csv = queriesToCsv([
      { id: 'sql_1', name: 'A "quoted", name', queryText: "SELECT a,\n b FROM [X] WHERE c = 'd'", timeStamp: Date.UTC(2026, 0, 2) },
      { id: 'email_1', assetId: 1, name: 'email' },
      { id: 'setting' },
    ])
    const rows = parseCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(['Time Saved', 'Name', 'Query Text'])
    expect(rows[1][1]).toBe('A "quoted", name')
    expect(rows[1][2]).toBe("SELECT a,\n b FROM [X] WHERE c = 'd'")
  })

  it('imports data rows, skipping empty SQL', () => {
    const csv = 'Time Saved,Name,Query Text\r\n"bad date","",SELECT 1\r\n"x","y",""\r\n'
    const recs = Object.values(csvToQueryRecords(csv, 5000))
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ id: 'sql_5000_0', name: 'Imported Query', queryText: 'SELECT 1', timeStamp: 5000 })
  })

  it('names the file with the date and time', () => {
    expect(csvFileName(new Date(2026, 9, 14, 9, 5, 7))).toBe('sfmc_queries_20261014_090507.csv')
  })
})
