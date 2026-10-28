import { describe, it, expect } from 'vitest'
import { planUnderscoreRenames, wrapWithRenamedColumns } from '../columnNames.js'

describe('planUnderscoreRenames', () => {
  it('prefixes names that start with an underscore with t', () => {
    const r = planUnderscoreRenames(['Id', '_ContactKey', 'Email'])
    expect([...r]).toEqual([['_ContactKey', 't_ContactKey']])
  })

  it('uses t1, t2 when the t name is already an output column', () => {
    const r = planUnderscoreRenames(['_ContactKey', 't_ContactKey', 't1_ContactKey'])
    expect(r.get('_ContactKey')).toBe('t2_ContactKey')
  })

  it('compares names case-insensitively', () => {
    const r = planUnderscoreRenames(['_Key', 'T_KEY'])
    expect(r.get('_Key')).toBe('t1_Key')
  })

  it('returns an empty map when nothing needs renaming', () => {
    expect(planUnderscoreRenames(['a', 'b_c']).size).toBe(0)
  })
})

describe('wrapWithRenamedColumns', () => {
  const renames = new Map([['_ContactKey', 't_ContactKey']])

  it('wraps the query and renames only the listed columns', () => {
    const sql = 'SELECT * FROM [Contact_Salesforce]'
    expect(wrapWithRenamedColumns(sql, ['Id', '_ContactKey'], renames)).toBe(
      'SELECT q.[Id], q.[_ContactKey] AS [t_ContactKey]\nFROM (\nSELECT * FROM [Contact_Salesforce]\n) AS q'
    )
  })

  it('drops a top-level ORDER BY without TOP', () => {
    const out = wrapWithRenamedColumns('SELECT * FROM x ORDER BY Id', ['_ContactKey'], renames)
    expect(out).toContain('(\nSELECT * FROM x\n)')
  })

  it('keeps ORDER BY when the query has TOP', () => {
    const out = wrapWithRenamedColumns('SELECT TOP 10 * FROM x ORDER BY Id', ['_ContactKey'], renames)
    expect(out).toContain('ORDER BY Id')
  })

  it('keeps ORDER BY inside a subquery or a string', () => {
    const sql = "SELECT * FROM x WHERE a = 'ORDER BY' AND b IN (SELECT TOP 1 b FROM y ORDER BY b)"
    expect(wrapWithRenamedColumns(sql, ['_ContactKey'], renames)).toContain(sql)
  })

  it('puts the closing parenthesis on its own line so a trailing comment is safe', () => {
    const out = wrapWithRenamedColumns('SELECT * FROM x -- note', ['_ContactKey'], renames)
    expect(out.endsWith('-- note\n) AS q')).toBe(true)
  })
})
