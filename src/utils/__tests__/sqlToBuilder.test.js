import { describe, it, expect } from 'vitest'
import { parseSqlForBuilder, builderFromParsed, splitSetOperations } from '../sqlToBuilder.js'
import { buildSqlFromSelections } from '../sqlBuilder.js'
import { DATA_VIEW_FIELDS } from '../dataViews.js'

const f = (...n) => n.map((name) => ({ name }))
const CATALOG = {
  'my de': { id: 'de1', name: 'My DE', sourceType: 'dataextension', fields: f('Subscriber Key', 'Email', 'X', 'Y', 'D', 'Q') },
  'shared one': { id: 'de2', name: 'Shared One', sourceType: 'shared', fields: f('SubscriberKey', 'Email', 'Y', 'Z') },
}
const resolve = (t) => {
  if (t.dataView) return { id: `dv:${t.name}`, name: t.name, sourceType: 'dataview', isDataView: true, fields: DATA_VIEW_FIELDS[t.name.toUpperCase()] }
  return CATALOG[t.name.toLowerCase()] || null
}
const roundTrip = async (sql) => {
  const parsed = parseSqlForBuilder(sql)
  if (parsed.error) return { error: parsed.error }
  const m = await builderFromParsed(parsed, resolve)
  return { ...m, sql: buildSqlFromSelections(m.selectedDEs, m.joins, m.where, m.queryOptions) }
}

describe('SQL to Query Builder', () => {
  it('reads tables, aliases, joins, ticks, filters and options', async () => {
    const r = await roundTrip(`SELECT DISTINCT TOP 10 a.[Subscriber Key] AS SK, b.Email, COUNT(*) AS n
      FROM [My DE] AS a
      LEFT JOIN ENT.[Shared One] b ON a.[Subscriber Key] = b.SubscriberKey AND b.y > a.y
      INNER JOIN _Sent s WITH (NOLOCK) ON s.SubscriberKey = a.[Subscriber Key]
      WHERE a.x = 'abc' AND (b.y IN (1,2) OR b.z IS NULL) AND a.d >= DATEADD(DAY,-7,GETDATE()) AND a.q BETWEEN 1 AND 5
      GROUP BY a.[Subscriber Key], b.Email HAVING COUNT(*) > 1 ORDER BY n DESC`)
    expect(r.selectedDEs.map((d) => [d.alias, d.name])).toEqual([['a', 'My DE'], ['b', 'Shared One'], ['s', '_Sent']])
    expect(r.joins[0]).toMatchObject({ leftDeId: 'de1', rightDeId: 'de2', joinType: 'LEFT JOIN' })
    expect(r.joins[0].conditions[1]).toMatchObject({ leftField: 'Y', operator: '<', rightField: 'Y' })
    expect(r.sql).toBe([
      'SELECT DISTINCT TOP 10',
      '  a.[Subscriber Key] AS [SK],',
      '  b.[Email],',
      '  COUNT(*) AS [n]',
      'FROM [My DE] AS a',
      'LEFT JOIN ENT.[Shared One] AS b ON a.[Subscriber Key] = b.[SubscriberKey]',
      '    AND a.[Y] < b.[Y]',
      'INNER JOIN _Sent AS s ON a.[Subscriber Key] = s.[SubscriberKey]',
      "WHERE a.[X] = 'abc'",
      '  AND (b.[Y] IN (1, 2)',
      '    OR b.[Z] IS NULL)',
      '  AND a.[D] >= DATEADD(DAY,-7,GETDATE())',
      '  AND a.q BETWEEN 1 AND 5',
      'GROUP BY a.[Subscriber Key], b.[Email]',
      'HAVING COUNT(*) > 1',
      'ORDER BY [n] DESC',
    ].join('\n'))
  })

  it('keeps the column order and expressions as written', async () => {
    const r = await roundTrip(`SELECT CASE WHEN Email LIKE '%@x.com' THEN 1 ELSE 0 END AS IsX, [Subscriber Key] FROM [My DE] WHERE Email LIKE '%@%' ORDER BY [Subscriber Key]`)
    expect(r.sql).toBe([
      'SELECT',
      "  CASE WHEN Email LIKE '%@x.com' THEN 1 ELSE 0 END AS [IsX],",
      '  md.[Subscriber Key]',
      'FROM [My DE] AS md',
      "WHERE md.[Email] LIKE '%@%'",
      'ORDER BY md.[Subscriber Key] ASC',
    ].join('\n'))
    expect(r.notes).toContain('My DE had no alias; it is md now.')
  })

  it('a.* and * tick every field', async () => {
    const r = await roundTrip('SELECT a.* FROM [My DE] a')
    expect(r.selectedDEs[0].selectedFields).toBe(null)
  })

  it('keeps an ON it cannot split as a hand-written ON', async () => {
    const r = await roundTrip(`SELECT a.Email FROM [My DE] a JOIN [Shared One] b ON LOWER(a.Email) = LOWER(b.Email)`)
    expect(r.joins[0]).toMatchObject({ rawOn: true, onClause: 'LOWER(a.Email) = LOWER(b.Email)' })
    expect(r.sql).toContain('INNER JOIN ENT.[Shared One] AS b ON LOWER(a.Email) = LOWER(b.Email)')
  })

  it('mixed AND/OR follow precedence', async () => {
    const r = await roundTrip(`SELECT a.Email FROM [My DE] a WHERE a.X = 1 OR a.Y = 2 AND a.Z = 3`)
    expect(r.where).toEqual({ combinator: 'OR', conditions: [
      { alias: 'a', field: 'X', operator: '=', value: '1', raw: false },
      { combinator: 'AND', conditions: [
        { alias: 'a', field: 'Y', operator: '=', value: '2', raw: false },
        { alias: 'a', field: 'Z', operator: '=', value: '3', raw: false },
      ] },
    ] })
  })

  it('an unknown table becomes a card with the fields the query uses', async () => {
    const r = await roundTrip(`SELECT n.Foo, a.Email FROM [My DE] a JOIN [Nowhere] n ON n.Key = a.Email`)
    const card = r.selectedDEs[1]
    expect(card).toMatchObject({ missing: true, name: 'Nowhere' })
    expect(card.fields.map((x) => x.name).sort()).toEqual(['Foo', 'Key'])
    expect(r.notes.some((n) => n.includes('Nowhere was not found'))).toBe(true)
  })

  it('says what it cannot draw', () => {
    expect(parseSqlForBuilder('WITH x AS (SELECT 1 a) SELECT * FROM x').error).toMatch(/WITH/)
    expect(parseSqlForBuilder('UPDATE x SET a = 1').error).toMatch(/SELECT/)
    const u = parseSqlForBuilder('SELECT a FROM [My DE] UNION ALL SELECT a FROM [Shared One]')
    expect(u.notes[0]).toMatch(/UNION: only the first of 2/)
    expect(u.tables).toHaveLength(1)
  })

  it('a subquery in FROM becomes a card with its columns, written back as is', async () => {
    const r = await roundTrip(`SELECT x.[Key], s.EmailAddress FROM (SELECT SubscriberKey AS [Key], MAX(EventDate) LastOpen FROM _Open GROUP BY SubscriberKey) AS x
      LEFT JOIN _Subscribers s ON s.SubscriberKey = x.[Key]`)
    expect(r.selectedDEs[0]).toMatchObject({ sourceType: 'subquery', alias: 'x', fields: [{ name: 'Key' }, { name: 'LastOpen' }] })
    expect(r.sql).toContain('FROM (\n  SELECT SubscriberKey AS [Key], MAX(EventDate) LastOpen FROM _Open GROUP BY SubscriberKey\n) AS x')
    expect(r.sql).toContain('LEFT JOIN _Subscribers AS s ON x.[Key] = s.[SubscriberKey]')
  })

  it('splits UNION / EXCEPT / INTERSECT into one SELECT each', () => {
    expect(splitSetOperations('SELECT a FROM t UNION ALL SELECT a FROM (SELECT 1 a UNION SELECT 2) u EXCEPT SELECT 3')).toEqual({
      branches: ['SELECT a FROM t', 'SELECT a FROM (SELECT 1 a UNION SELECT 2) u', 'SELECT 3'],
      ops: ['UNION ALL', 'EXCEPT'],
    })
  })
})
