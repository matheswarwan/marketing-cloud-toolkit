import { describe, it, expect } from 'vitest'
import { formatSql, sameTokens } from '../sqlFormat.js'

describe('formatSql', () => {
  it('upper-cases keywords and breaks clauses onto lines', () => {
    const r = formatSql('select a.Email, count(*) as c from [My DE] a where a.x = 1 group by a.Email')
    expect(r.ok).toBe(true)
    expect(r.sql).toMatch(/^SELECT\n/)
    expect(r.sql).toContain('\nFROM\n')
    expect(r.sql).toContain('[My DE] a')
    expect(r.sql).toContain('GROUP BY')
  })

  it('keeps strings, brackets and comments exactly', () => {
    const sql = "select 'BOB''S, inc' as n, [Field Name] /* keep */ from x -- end"
    const r = formatSql(sql)
    expect(r.ok).toBe(true)
    expect(r.sql).toContain("'BOB''S, inc'")
    expect(r.sql).toContain('[Field Name]')
    expect(r.sql).toContain('/* keep */')
    expect(r.sql).toContain('-- end')
  })

  it('formats data view queries with joins', () => {
    const r = formatSql('select s.SubscriberKey from _Sent s inner join _Open o on o.JobID = s.JobID and o.SubscriberKey = s.SubscriberKey where s.EventDate > dateadd(day,-7,getdate())')
    expect(r.ok).toBe(true)
    expect(r.sql).toContain('INNER JOIN _Open o')
  })

  it('returns the input unchanged for empty text', () => {
    expect(formatSql('  ')).toEqual({ ok: false, sql: '  ', error: 'Nothing to format' })
  })
})

describe('sameTokens', () => {
  it('ignores whitespace and keyword case', () => {
    expect(sameTokens('select a from b', 'SELECT\n  a\nFROM b')).toBe(true)
  })
  it('notices a changed string or a dropped token', () => {
    expect(sameTokens("select 'a'", "select 'A'")).toBe(false)
    expect(sameTokens('select a, b from c', 'select a from c')).toBe(false)
  })
})
