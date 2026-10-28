import { describe, it, expect } from 'vitest'
import { extractDataExtensions, extractSelectColumns, inferSelectColumnTypes, inferSelectColumnDetails } from '../sqlParser.js'

describe('extractDataExtensions', () => {
  it('extracts a single FROM table (plain name)', () => {
    expect(extractDataExtensions('SELECT * FROM MyDE')).toEqual(['MyDE'])
  })

  it('extracts FROM and JOIN tables', () => {
    const sql = 'SELECT a.* FROM ContactDE a JOIN EmailDE b ON a.id = b.id'
    const result = extractDataExtensions(sql)
    expect(result).toContain('ContactDE')
    expect(result).toContain('EmailDE')
  })

  it('handles bracket notation with spaces', () => {
    expect(extractDataExtensions('SELECT * FROM [My Data Extension]')).toEqual(['My Data Extension'])
  })

  it('reads ENT.[My DE] as My DE, not ENT, when the grammar falls back', () => {
    // "Local" is a keyword in the grammar, so this uses the regex fallback.
    const sql = 'SELECT a.x FROM ENT.[My DE] a JOIN Local b ON a.id = b.id'
    expect(extractDataExtensions(sql)).toEqual(['My DE', 'Local'])
  })

  it('handles mixed bracket and plain names', () => {
    const sql = 'SELECT * FROM [Source DE] JOIN TargetDE ON a.id = b.id'
    const result = extractDataExtensions(sql)
    expect(result).toContain('Source DE')
    expect(result).toContain('TargetDE')
  })

  it('deduplicates repeated table names', () => {
    const sql = 'SELECT * FROM MyDE a JOIN MyDE b ON a.id = b.id'
    expect(extractDataExtensions(sql)).toEqual(['MyDE'])
  })

  it('handles LEFT JOIN, INNER JOIN, RIGHT JOIN', () => {
    const sql = 'SELECT * FROM A LEFT JOIN B ON A.id = B.id INNER JOIN C ON B.id = C.id RIGHT JOIN D ON C.id = D.id'
    const result = extractDataExtensions(sql)
    expect(result).toContain('A')
    expect(result).toContain('B')
    expect(result).toContain('C')
    expect(result).toContain('D')
  })

  it('returns empty array for empty input', () => {
    expect(extractDataExtensions('')).toEqual([])
    expect(extractDataExtensions(null)).toEqual([])
    expect(extractDataExtensions(undefined)).toEqual([])
  })

  it('is case-insensitive for FROM/JOIN keywords', () => {
    const sql = 'select * from MyDE join OtherDE on MyDE.id = OtherDE.id'
    const result = extractDataExtensions(sql)
    expect(result).toContain('MyDE')
    expect(result).toContain('OtherDE')
  })
})

describe('extractSelectColumns', () => {
  it('returns empty array for SELECT *', () => {
    expect(extractSelectColumns('SELECT * FROM MyDE')).toEqual([])
  })

  it('extracts simple column names', () => {
    const result = extractSelectColumns('SELECT col1, col2, col3 FROM MyDE')
    expect(result).toEqual(['col1', 'col2', 'col3'])
  })

  it('extracts alias from col AS alias', () => {
    const result = extractSelectColumns('SELECT firstName AS fname, lastName AS lname FROM MyDE')
    expect(result).toEqual(['fname', 'lname'])
  })

  it('extracts alias from table-qualified column: a.col AS alias', () => {
    const result = extractSelectColumns('SELECT a.firstName AS fname, b.email FROM ContactDE a JOIN EmailDE b ON a.id = b.id')
    expect(result).toEqual(['fname', 'email'])
  })

  it('handles mixed aliased and plain columns', () => {
    const result = extractSelectColumns('SELECT col1 AS alias1, col2 FROM MyDE')
    expect(result).toEqual(['alias1', 'col2'])
  })

  it('returns empty array for empty/null/undefined input', () => {
    expect(extractSelectColumns('')).toEqual([])
    expect(extractSelectColumns(null)).toEqual([])
    expect(extractSelectColumns(undefined)).toEqual([])
  })

  it('is case-insensitive for SELECT/AS keywords', () => {
    const result = extractSelectColumns('select col1 as alias1, col2 from MyDE')
    expect(result).toEqual(['alias1', 'col2'])
  })

  it('handles SELECT * with no columns', () => {
    expect(extractSelectColumns('SELECT * FROM [My Data Extension]')).toEqual([])
  })

  it('handles SELECT DISTINCT', () => {
    expect(extractSelectColumns('SELECT DISTINCT col1, col2 FROM MyDE')).toEqual(['col1', 'col2'])
  })

  it('handles SELECT TOP N', () => {
    expect(extractSelectColumns('SELECT TOP 100 col1, col2 FROM MyDE')).toEqual(['col1', 'col2'])
  })

  it('handles bracket-notation column with alias', () => {
    expect(extractSelectColumns('SELECT [First Name] AS fname, [Email Address] AS email FROM MyDE')).toEqual(['fname', 'email'])
  })

  it('handles bracket-notation column without alias', () => {
    expect(extractSelectColumns('SELECT [First Name] FROM MyDE')).toEqual(['First Name'])
  })

  it('extracts alias from CAST expression: CAST(col AS DATE) AS alias', () => {
    const sql = 'SELECT CAST(s.EventDate AS DATE) AS SendDate FROM _Sent s'
    expect(extractSelectColumns(sql)).toEqual(['SendDate'])
  })

  it('extracts alias from aggregate function: COUNT(DISTINCT col) AS alias', () => {
    const sql = 'SELECT COUNT(DISTINCT s.SubscriberID) AS EmailSends FROM _Sent s'
    expect(extractSelectColumns(sql)).toEqual(['EmailSends'])
  })

  it('extracts all aliases from mixed query with CAST and COUNT', () => {
    const sql = `SELECT s.JobID AS JobID, CAST(s.EventDate AS DATE) AS SendDate, COUNT(DISTINCT s.SubscriberID) AS EmailSends FROM _Sent s`
    expect(extractSelectColumns(sql)).toEqual(['JobID', 'SendDate', 'EmailSends'])
  })

  it('handles CONVERT(DATE, col) AS alias without spurious DATE column', () => {
    const sql = 'SELECT CONVERT(DATE, s.EventDate) AS SendDate FROM _Sent s'
    expect(extractSelectColumns(sql)).toEqual(['SendDate'])
  })

  it('handles complex multi-join query with CONVERT, COUNT, SUM(CASE)', () => {
    const sql = `SELECT j.EmailName AS EmailName, CONVERT(DATE, s.EventDate) AS SendDate, COUNT(DISTINCT s.SubscriberID) AS EmailSends, SUM(CASE WHEN b.SubscriberID IS NOT NULL THEN 1 ELSE 0 END) AS EmailBounces, COUNT(DISTINCT o.SubscriberID) AS EmailUniqueOpens FROM _Sent s LEFT JOIN _Job j ON s.JobID = j.JobID LEFT JOIN _Bounce b ON s.JobID = b.JobID LEFT JOIN _Open o ON s.JobID = o.JobID`
    expect(extractSelectColumns(sql)).toEqual(['EmailName', 'SendDate', 'EmailSends', 'EmailBounces', 'EmailUniqueOpens'])
  })
})

describe('inferSelectColumnTypes', () => {
  it('returns empty object for SELECT *', () => {
    expect(inferSelectColumnTypes('SELECT * FROM MyDE')).toEqual({})
  })

  it('maps CAST AS DATE alias to SFMC type 2', () => {
    const sql = 'SELECT CAST(s.EventDate AS DATE) AS SendDate FROM _Sent s'
    expect(inferSelectColumnTypes(sql)).toEqual({ senddate: 2 })
  })

  it('maps CAST AS INT alias to SFMC type 1', () => {
    const sql = 'SELECT CAST(col AS INT) AS MyNum FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ mynum: 1 })
  })

  it('maps CAST AS DECIMAL alias to SFMC type 6', () => {
    const sql = 'SELECT CAST(col AS DECIMAL) AS MyDec FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ mydec: 6 })
  })

  it('ignores plain columns but types COUNT as Number', () => {
    const sql = 'SELECT col1 AS alias1, COUNT(x) AS cnt FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ cnt: 1 })
  })

  it('types date functions as Date (feedback: date field not created properly)', () => {
    const sql = "SELECT GETDATE() AS RunDate, DATEADD(day, -1, GETDATE()) AS Yesterday, CURRENT_TIMESTAMP AS Now FROM MyDE"
    expect(inferSelectColumnTypes(sql)).toEqual({ rundate: 2, yesterday: 2, now: 2 })
  })

  it('types DATEDIFF, LEN and ROW_NUMBER as Number', () => {
    const sql = 'SELECT DATEDIFF(day, a, b) AS Days, LEN(x) AS L, ROW_NUMBER() OVER (ORDER BY a) AS rn FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ days: 1, l: 1, rn: 1 })
  })

  it('maps CAST AS SMALLDATETIME to Date', () => {
    expect(inferSelectColumnTypes('SELECT CAST(x AS SMALLDATETIME) AS d FROM MyDE')).toEqual({ d: 2 })
  })

  it('handles multiple CAST columns', () => {
    const sql = 'SELECT CAST(a AS DATE) AS dt, CAST(b AS INT) AS num FROM MyDE'
    const result = inferSelectColumnTypes(sql)
    expect(result).toEqual({ dt: 2, num: 1 })
  })

  it('maps CONVERT(DATE, col) AS alias to SFMC type 2', () => {
    const sql = 'SELECT CONVERT(DATE, s.EventDate) AS SendDate FROM _Sent s'
    expect(inferSelectColumnTypes(sql)).toEqual({ senddate: 2 })
  })

  it('maps CONVERT(INT, col) AS alias to SFMC type 1', () => {
    const sql = 'SELECT CONVERT(INT, col) AS MyNum FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ mynum: 1 })
  })

  it('handles mixed CAST and CONVERT in same query', () => {
    const sql = 'SELECT CAST(a AS DATE) AS dt, CONVERT(INT, b) AS num FROM MyDE'
    expect(inferSelectColumnTypes(sql)).toEqual({ dt: 2, num: 1 })
  })

  it('returns empty for empty/null/undefined input', () => {
    expect(inferSelectColumnTypes('')).toEqual({})
    expect(inferSelectColumnTypes(null)).toEqual({})
    expect(inferSelectColumnTypes(undefined)).toEqual({})
  })
})

describe('inferSelectColumnDetails', () => {
  it('points aliased pass-through columns at their source column', () => {
    const sql = 'SELECT s.EventDate AS SendDate, MAX(s.EventDate) AS LastSend, ISNULL(s.Email, \'\') AS Mail, s.JobID FROM _Sent s'
    expect(inferSelectColumnDetails(sql)).toEqual({
      senddate: { source: 'eventdate' },
      lastsend: { source: 'eventdate' },
      mail:     { source: 'email' },
    })
  })

  it('keeps DECIMAL precision and scale from CAST', () => {
    const sql = 'SELECT CAST(x AS DECIMAL(10,4)) AS amt FROM MyDE'
    expect(inferSelectColumnDetails(sql)).toEqual({ amt: { type: 6, length: 10, scale: 4 } })
  })

  it('returns types for functions', () => {
    expect(inferSelectColumnDetails('SELECT GETDATE() AS d FROM MyDE')).toEqual({ d: { type: 2 } })
  })
})
