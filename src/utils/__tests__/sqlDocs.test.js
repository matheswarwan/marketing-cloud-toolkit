import { describe, it, expect } from 'vitest'
import {
  SQL_FUNCTIONS, SQL_KEYWORDS, SQL_DATA_TYPES, DATE_PARTS,
  getFunctionDoc, signatureAt, hoverDocAt,
} from '../sqlDocs.js'
import { DATA_VIEW_INFO, FIELD_VALUES, DATA_VIEW_FIELDS } from '../dataViews.js'

// position just after the first occurrence of `marker` (or at its start)
const at = (sql, marker, after = true) => sql.indexOf(marker) + (after ? marker.length : 0)

describe('reference data', () => {
  it('has a reasonable number of functions, each with the required fields', () => {
    const entries = Object.entries(SQL_FUNCTIONS)
    expect(entries.length).toBeGreaterThanOrEqual(90)
    for (const [key, doc] of entries) {
      expect(key).toBe(key.toUpperCase())
      expect(doc.name).toBe(key)
      expect(typeof doc.signature).toBe('string')
      expect(doc.signature.length).toBeGreaterThan(0)
      expect(typeof doc.description).toBe('string')
      expect(doc.description.length).toBeGreaterThan(0)
      expect(typeof doc.category).toBe('string')
    }
  })

  it('uses no em dashes in any text', () => {
    const all = JSON.stringify([SQL_FUNCTIONS, DATA_VIEW_INFO, FIELD_VALUES])
    expect(all).not.toMatch(/—/)
  })

  it('lists keywords, data types and date parts', () => {
    expect(SQL_KEYWORDS).toContain('CROSS APPLY')
    expect(SQL_KEYWORDS).toContain('PARTITION BY')
    expect(SQL_DATA_TYPES).toContain('DATETIME2')
    expect(DATE_PARTS).toContain('dayofyear')
    expect(DATE_PARTS).toContain('dd')
  })

  it('has data view info for the main views, with keys present in DATA_VIEW_FIELDS', () => {
    for (const key of ['_SENT', '_SUBSCRIBERS', '_JOURNEY', '_AUTOMATIONINSTANCE', '_PUSHTAG']) {
      expect(DATA_VIEW_INFO[key].description).toBeTruthy()
    }
    expect(DATA_VIEW_INFO._SENT.joinKeys).toEqual(['JobID', 'ListID', 'BatchID', 'SubscriberID'])
    for (const key of Object.keys(DATA_VIEW_INFO)) {
      expect(DATA_VIEW_FIELDS[key], key).toBeTruthy()
    }
  })

  it('field value keys point to real data view fields', () => {
    for (const key of Object.keys(FIELD_VALUES)) {
      const [view, field] = key.split('.')
      const fields = DATA_VIEW_FIELDS[view]
      expect(fields, key).toBeTruthy()
      expect(fields.some(f => f.name.toUpperCase() === field), key).toBe(true)
    }
  })
})

describe('getFunctionDoc', () => {
  it('is case-insensitive', () => {
    expect(getFunctionDoc('dateadd')).toBe(SQL_FUNCTIONS.DATEADD)
    expect(getFunctionDoc('DateAdd')).toBe(SQL_FUNCTIONS.DATEADD)
    expect(getFunctionDoc('GETDATE').sfmc).toMatch(/Central/)
  })
  it('returns null for unknown names and bad input', () => {
    expect(getFunctionDoc('NOT_A_FUNC')).toBeNull()
    expect(getFunctionDoc(null)).toBeNull()
    expect(getFunctionDoc('')).toBeNull()
  })
})

describe('signatureAt', () => {
  const sql = 'SELECT DATEADD(day, -1, GETDATE()) FROM x'

  it('returns the inner function inside nested parens', () => {
    const r = signatureAt(sql, at(sql, 'GETDATE('))
    expect(r.name).toBe('GETDATE')
    expect(r.argIndex).toBe(0)
  })

  it('counts arguments of the outer function', () => {
    expect(signatureAt(sql, at(sql, 'DATEADD(')).argIndex).toBe(0)
    expect(signatureAt(sql, at(sql, 'day,')).argIndex).toBe(1)
    const r = signatureAt(sql, at(sql, '-1,'))
    expect(r.name).toBe('DATEADD')
    expect(r.argIndex).toBe(2)
    // after GETDATE() closes, still in DATEADD arg 2
    expect(signatureAt(sql, at(sql, 'GETDATE()')).name).toBe('DATEADD')
  })

  it('ignores commas inside strings, including escaped quotes', () => {
    const s = "SELECT REPLACE(Name, 'a,b''c,d', 'x') FROM y"
    expect(signatureAt(s, at(s, "''c,")).argIndex).toBe(1)
    expect(signatureAt(s, at(s, "d', ")).argIndex).toBe(2)
  })

  it('ignores commas in nested non-function parens', () => {
    const s = 'SELECT IIF(a IN (1, 2, 3), 1, 0) FROM t'
    expect(signatureAt(s, at(s, '3)')).argIndex).toBe(0)
    expect(signatureAt(s, at(s, '3), 1,')).argIndex).toBe(2)
  })

  it('returns null outside parentheses and for unknown functions', () => {
    expect(signatureAt(sql, 3)).toBeNull()
    expect(signatureAt(sql, at(sql, 'DATEADD', false))).toBeNull()
    expect(signatureAt(sql, sql.length)).toBeNull()
    expect(signatureAt('SELECT myfunc(a, b)', 15)).toBeNull()
  })

  it('does not treat LEFT JOIN as a call', () => {
    const s = 'SELECT a FROM t LEFT JOIN u ON (t.id = u.id)'
    expect(signatureAt(s, at(s, '(t.'))).toBeNull()
  })
})

describe('hoverDocAt', () => {
  it('finds a function only when followed by (', () => {
    const s = 'SELECT LEFT(Email, 3) FROM t LEFT JOIN u ON 1 = 1'
    const r = hoverDocAt(s, 9)
    expect(r.kind).toBe('function')
    expect(r.doc.name).toBe('LEFT')
    expect(s.slice(r.from, r.to)).toBe('LEFT')
    expect(hoverDocAt(s, at(s, 't LEFT') + 3)).toBeNull()
  })

  it('finds a data view, case-insensitively and with ENT.', () => {
    const s = 'SELECT s.SubscriberKey FROM ENT._sent s'
    const r = hoverDocAt(s, at(s, '_se'))
    expect(r.kind).toBe('dataview')
    expect(r.doc).toBe(DATA_VIEW_INFO._SENT.description)
    expect(r.info.joinKeys).toContain('JobID')
    expect(s.slice(r.from, r.to)).toBe('_sent')
  })

  it('finds a data view field through an alias, with known values', () => {
    const s = "SELECT b.BounceCategory FROM _Bounce b WHERE b.BounceCategory = 'Hard bounce'"
    const r = hoverDocAt(s, at(s, 'b.Bou'))
    expect(r.kind).toBe('field')
    expect(r.field.view).toBe('_BOUNCE')
    expect(r.field.values).toContain('Hard bounce')
  })

  it('finds an unqualified field when only one data view is used', () => {
    const s = 'SELECT Status FROM _Subscribers'
    const r = hoverDocAt(s, 9)
    expect(r.kind).toBe('field')
    expect(r.field.name).toBe('Status')
  })

  it('returns null for plain words and inside strings or comments', () => {
    expect(hoverDocAt('SELECT foo FROM bar', 8)).toBeNull()
    const s = "SELECT 'LEFT(x) _Sent' FROM t -- GETDATE()"
    expect(hoverDocAt(s, at(s, "'LE"))).toBeNull()
    expect(hoverDocAt(s, at(s, '_Se'))).toBeNull()
    expect(hoverDocAt(s, at(s, 'GETD'))).toBeNull()
  })
})
