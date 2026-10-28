import { describe, it, expect } from 'vitest'
import {
  buildSqlFromSelections,
  buildSqlFromGraph,
  buildOnExpression,
  buildWhereBody,
  suggestJoinConditions,
  suggestOnClause,
  aliasOf,
  resolveSelectionTables,
  resolveGraphTables,
  fieldOptionsFromTables,
} from '../sqlBuilder.js'

describe('sqlBuilder — visual graph', () => {
  it('orients a reversed edge so aliases never collapse onto one table', () => {
    // Node order: bounce (t1) then testjp (t2). Edge drawn testjp -> bounce.
    const nodes = [
      { id: 'bounce', data: { id: 'bounce', name: '_Bounce', sourceType: 'dataview', selectedFields: null, fields: [{ name: 'SubscriberKey' }] } },
      { id: 'testjp', data: { id: 'testjp', name: 'TestJP', sourceType: 'folder', selectedFields: null, fields: [{ name: 'emailAddress' }] } },
    ]
    const edges = [{
      id: 'testjp__bounce', source: 'testjp', target: 'bounce',
      data: { joinType: 'INNER JOIN', combinator: 'AND', conditions: [{ leftField: 'emailAddress', operator: '=', rightField: 'SubscriberKey' }] },
    }]
    const sql = buildSqlFromGraph(nodes, edges)
    // t1 = _Bounce, t2 = TestJP; ON must reference each table's own column.
    expect(sql).toContain('INNER JOIN [TestJP] AS t2 ON t1.[SubscriberKey] = t2.[emailAddress]')
    expect(sql).not.toContain('t2.[SubscriberKey]')
  })
})

describe('sqlBuilder — SELECT/FROM', () => {
  it('falls back to tN.* only when a DE has no known fields', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'MyDE', sourceType: 'folder', selectedFields: null, fields: [] },
    ])
    expect(sql).toContain('SELECT')
    expect(sql).toContain('t1.*')
    expect(sql).toContain('FROM [MyDE] AS t1')
  })

  it('enumerates all fields instead of SELECT * when fields are known', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'DE', sourceType: 'folder', selectedFields: null, fields: [{ name: 'A' }, { name: 'B' }] },
    ])
    expect(sql).toContain('t1.[A]')
    expect(sql).toContain('t1.[B]')
    expect(sql).not.toContain('t1.*')
  })

  it('prefixes duplicate column names across DEs with the table alias', () => {
    const sql = buildSqlFromSelections(
      [
        { id: 'a', name: 'DE1', sourceType: 'folder', alias: 't1', selectedFields: ['JobID', 'Email'], fields: [] },
        { id: 'b', name: 'DE2', sourceType: 'folder', alias: 't2', selectedFields: ['JobID', 'Score'], fields: [] },
      ],
      [{ leftDeId: 'a', rightDeId: 'b', joinType: 'INNER JOIN', conditions: [{ leftField: 'JobID', operator: '=', rightField: 'JobID' }] }]
    )
    expect(sql).toContain('t1.[JobID] AS [t1_JobID]')
    expect(sql).toContain('t2.[JobID] AS [t2_JobID]')
    expect(sql).toContain('t1.[Email]')
    expect(sql).toContain('t2.[Score]')
    expect(sql).not.toContain('t1.[Email] AS')
  })

  it('emits explicit bracketed columns when fields are selected', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'MyDE', sourceType: 'folder', selectedFields: ['Subscriber Key', 'Email'], fields: [] },
    ])
    expect(sql).toContain('t1.[Subscriber Key]')
    expect(sql).toContain('t1.[Email]')
    expect(sql).not.toContain('t1.*')
  })

  it('reads Shared DEs as ENT.[name] (feedback #73)', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'Master', sourceType: 'shared', selectedFields: ['Email'], fields: [] },
    ])
    expect(sql).toContain('FROM ENT.[Master] AS')
  })

  it('brackets DE names with spaces', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'My DE', sourceType: 'folder', selectedFields: null, fields: [] },
    ])
    expect(sql).toContain('FROM [My DE] AS t1')
  })

  it('uses data view names without brackets', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: '_Subscribers', sourceType: 'dataview', selectedFields: ['SubscriberKey'], fields: [] },
    ])
    expect(sql).toContain('FROM _Subscribers AS t1')
  })
})

describe('sqlBuilder — custom aliases', () => {
  it('uses a custom alias in SELECT and FROM', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'Click_delete', sourceType: 'folder', alias: 'cd', selectedFields: null, fields: [] },
    ])
    expect(sql).toContain('cd.*')
    expect(sql).toContain('FROM [Click_delete] AS cd')
  })

  it('uses custom aliases across a JOIN', () => {
    const left = { id: 'a', name: 'DE1', sourceType: 'folder', alias: 'sendlog', selectedFields: null, fields: [] }
    const right = { id: 'b', name: 'DE2', sourceType: 'folder', alias: 'opens', selectedFields: null, fields: [] }
    const sql = buildSqlFromSelections([left, right], [{
      leftDeId: 'a', rightDeId: 'b', joinType: 'LEFT JOIN', combinator: 'AND',
      conditions: [{ leftField: 'JobID', operator: '=', rightField: 'JobID' }],
    }])
    expect(sql).toContain('FROM [DE1] AS sendlog')
    expect(sql).toContain('LEFT JOIN [DE2] AS opens ON sendlog.[JobID] = opens.[JobID]')
  })

  it('falls back to positional alias when custom alias is blank', () => {
    const sql = buildSqlFromSelections([
      { id: '1', name: 'DE', sourceType: 'folder', alias: '  ', selectedFields: null, fields: [] },
    ])
    expect(sql).toContain('t1.*')
    expect(sql).toContain('FROM [DE] AS t1')
  })
})

describe('sqlBuilder — JOIN', () => {
  const left = { id: 'a', name: 'DE1', sourceType: 'folder', selectedFields: null, fields: [{ name: 'JobID' }] }
  const right = { id: 'b', name: 'Open', sourceType: 'folder', selectedFields: null, fields: [{ name: 'Id' }] }

  it('builds a single-condition JOIN with brackets and AS', () => {
    const sql = buildSqlFromSelections([left, right], [{
      leftDeId: 'a', rightDeId: 'b', joinType: 'INNER JOIN', combinator: 'AND',
      conditions: [{ leftField: 'Subscriber Key', operator: '=', rightField: 'SubscriberKey' }],
    }])
    expect(sql).toContain('INNER JOIN [Open] AS t2 ON t1.[Subscriber Key] = t2.[SubscriberKey]')
  })

  it('combines multiple conditions with AND', () => {
    const on = buildOnExpression({
      combinator: 'AND',
      conditions: [
        { leftField: 'JobID', operator: '=', rightField: 'Id' },
        { leftField: 'EmailID', operator: '=', rightField: 'Email' },
      ],
    }, 't1', 't2')
    expect(on).toBe('t1.[JobID] = t2.[Id] AND t1.[EmailID] = t2.[Email]')
  })

  it('combines multiple conditions with OR', () => {
    const on = buildOnExpression({
      combinator: 'OR',
      conditions: [
        { leftField: 'JobID', operator: '=', rightField: 'Id' },
        { leftField: 'EmailID', operator: '=', rightField: 'Email' },
      ],
    }, 't1', 't2')
    expect(on).toBe('t1.[JobID] = t2.[Id] OR t1.[EmailID] = t2.[Email]')
  })

  it('returns null ON when no complete condition (no SubscriberKey invention)', () => {
    expect(buildOnExpression({ conditions: [] }, 't1', 't2')).toBeNull()
    expect(buildOnExpression({ conditions: [{ leftField: 'A', rightField: '' }] }, 't1', 't2')).toBeNull()
  })

  it('honours per-condition connectors: (a AND b) OR c via precedence', () => {
    const on = buildOnExpression({
      conditions: [
        { leftField: 'A', operator: '=', rightField: 'A' },
        { leftField: 'B', operator: '=', rightField: 'B', conn: 'AND' },
        { leftField: 'C', operator: '=', rightField: 'C', conn: 'OR' },
      ],
    }, 't1', 't2')
    expect(on).toBe('t1.[A] = t2.[A] AND t1.[B] = t2.[B] OR t1.[C] = t2.[C]')
  })

  it('puts extra JOIN conditions on their own indented lines', () => {
    const sql = buildSqlFromSelections([left, right], [{
      leftDeId: 'a', rightDeId: 'b', joinType: 'LEFT JOIN',
      conditions: [
        { leftField: 'JobID', operator: '=', rightField: 'Id' },
        { leftField: 'X', operator: '=', rightField: 'Y', conn: 'AND' },
      ],
    }])
    expect(sql).toContain('ON t1.[JobID] = t2.[Id]\n    AND t1.[X] = t2.[Y]')
  })

  it('uses a raw onClause when provided', () => {
    const on = buildOnExpression({ onClause: '(t1.[A] = t2.[A] AND t1.[B] = t2.[B]) OR (t1.[C] = t2.[C])' }, 't1', 't2')
    expect(on).toBe('(t1.[A] = t2.[A] AND t1.[B] = t2.[B]) OR (t1.[C] = t2.[C])')
  })

  it('emits TODO placeholder when a join has no condition', () => {
    const sql = buildSqlFromSelections([left, right], [{
      leftDeId: 'a', rightDeId: 'b', joinType: 'LEFT JOIN', conditions: [],
    }])
    expect(sql).toContain('/* TODO: set join condition */')
  })
})

describe('sqlBuilder — WHERE', () => {
  it('builds a WHERE clause with bracketed columns, quoted string and bare number', () => {
    const sql = buildSqlFromSelections(
      [{ id: '1', name: 'DE', sourceType: 'folder', selectedFields: null, fields: [] }],
      [],
      {
        combinator: 'AND',
        conditions: [
          { alias: 't1', field: 'Status', operator: '=', value: 'Active' },
          { alias: 't1', field: 'Score', operator: '>', value: '10' },
        ],
      }
    )
    expect(sql).toContain("WHERE t1.[Status] = 'Active'")
    expect(sql).toContain('AND t1.[Score] > 10')
  })

  it('passes raw values through verbatim', () => {
    const body = buildWhereBody({
      combinator: 'AND',
      conditions: [{ alias: 't1', field: 'SentDate', operator: '>=', value: 'DATEADD(day,-30,GETDATE())', raw: true }],
    })
    expect(body).toBe('t1.[SentDate] >= DATEADD(day,-30,GETDATE())')
  })

  it('handles IS NULL without a value', () => {
    const body = buildWhereBody({
      combinator: 'AND',
      conditions: [{ alias: 't2', field: 'offerName', operator: 'IS NOT NULL' }],
    })
    expect(body).toBe('t2.[offerName] IS NOT NULL')
  })

  it('quotes IN lists element by element', () => {
    const body = buildWhereBody({
      combinator: 'AND',
      conditions: [{ alias: 't1', field: 'Region', operator: 'IN', value: 'EU, US' }],
    })
    expect(body).toBe("t1.[Region] IN ('EU', 'US')")
  })

  it('escapes single quotes in string values', () => {
    const body = buildWhereBody({
      combinator: 'AND',
      conditions: [{ alias: 't1', field: 'Name', operator: '=', value: "O'Brien" }],
    })
    expect(body).toBe("t1.[Name] = 'O''Brien'")
  })
})

describe('sqlBuilder — query options', () => {
  const de = { id: '1', name: 'DE', sourceType: 'folder', selectedFields: ['A', 'B'], fields: [] }

  it('emits SELECT DISTINCT TOP n', () => {
    const sql = buildSqlFromSelections([de], [], null, { distinct: true, top: 100 })
    expect(sql.split('\n')[0]).toBe('SELECT DISTINCT TOP 100')
  })

  it('ignores a non-positive TOP', () => {
    const sql = buildSqlFromSelections([de], [], null, { top: 0 })
    expect(sql.split('\n')[0]).toBe('SELECT')
  })

  it('appends ORDER BY with direction', () => {
    const sql = buildSqlFromSelections([de], [], null, {
      orderBy: [{ alias: 't1', field: 'A', dir: 'DESC' }, { alias: 't1', field: 'B' }],
    })
    expect(sql).toContain('ORDER BY t1.[A] DESC, t1.[B] ASC')
  })

  it('GROUP BY narrows SELECT to grouped + computed columns', () => {
    const sql = buildSqlFromSelections([de], [], null, {
      groupBy: [{ alias: 't1', field: 'A' }],
      computedColumns: [{ expression: 'COUNT(t1.[B])', alias: 'cnt' }],
    })
    expect(sql).toContain('SELECT\n  t1.[A],\n  COUNT(t1.[B]) AS [cnt]')
    expect(sql).toContain('GROUP BY t1.[A]')
    expect(sql).not.toContain('t1.[B],') // B is not selected raw
  })

  it('appends computed columns to normal SELECT without GROUP BY', () => {
    const sql = buildSqlFromSelections([de], [], null, {
      computedColumns: [{ expression: 'GETDATE()', alias: 'now' }],
    })
    expect(sql).toContain('t1.[A]')
    expect(sql).toContain('GETDATE() AS [now]')
  })

  it('a raw fx IN value supports subqueries verbatim', () => {
    const body = buildWhereBody({
      combinator: 'AND',
      conditions: [{ alias: 't1', field: 'Id', operator: 'IN', value: '(SELECT Id FROM _Sent)', raw: true }],
    })
    expect(body).toBe('t1.[Id] IN (SELECT Id FROM _Sent)')
  })

  it('threads options through the visual graph builder', () => {
    const nodes = [{ id: '1', data: de }]
    const sql = buildSqlFromGraph(nodes, [], null, { distinct: true })
    expect(sql.split('\n')[0]).toBe('SELECT DISTINCT')
  })
})

describe('sqlBuilder — table resolvers', () => {
  it('resolveSelectionTables returns aliases + flat field names', () => {
    const tables = resolveSelectionTables([
      { id: 'a', name: 'DE1', alias: 'ord', fields: [{ name: 'X' }, { name: 'Y' }] },
      { id: 'b', name: 'DE2', fields: [{ name: 'Z' }] },
    ])
    expect(tables).toEqual([
      { deId: 'a', name: 'DE1', alias: 'ord', fields: ['X', 'Y'] },
      { deId: 'b', name: 'DE2', alias: 't2', fields: ['Z'] },
    ])
  })

  it('resolveGraphTables follows topological order for aliases', () => {
    const nodes = [
      { id: 'bounce', data: { id: 'bounce', name: '_Bounce', fields: [{ name: 'SubscriberKey' }] } },
      { id: 'testjp', data: { id: 'testjp', name: 'TestJP', fields: [{ name: 'emailAddress' }] } },
    ]
    const edges = [{ id: 'e', source: 'testjp', target: 'bounce', data: { conditions: [] } }]
    const tables = resolveGraphTables(nodes, edges)
    // Walk starts at nodes[0] (bounce) → alias t1, then testjp → t2.
    expect(tables.map((t) => `${t.alias}:${t.name}`)).toEqual(['t1:_Bounce', 't2:TestJP'])
  })

  it('fieldOptionsFromTables flattens to alias/field/label', () => {
    const opts = fieldOptionsFromTables([{ deId: 'a', name: 'DE', alias: 't1', fields: ['A'] }])
    expect(opts).toEqual([{ alias: 't1', field: 'A', label: 't1.A', deName: 'DE' }])
  })
})

describe('sqlBuilder — suggestions', () => {
  it('suggestJoinConditions matches SubscriberKey on both sides', () => {
    const pairs = suggestJoinConditions(
      { fields: [{ name: 'SubscriberKey' }] },
      { fields: [{ name: 'SubscriberKey' }] },
    )
    expect(pairs).toEqual([{ leftField: 'SubscriberKey', operator: '=', rightField: 'SubscriberKey' }])
  })

  it('suggestJoinConditions returns [] when no shared field', () => {
    const pairs = suggestJoinConditions(
      { fields: [{ name: 'JobID' }] },
      { fields: [{ name: 'LeadId' }] },
    )
    expect(pairs).toEqual([])
  })

  it('suggestOnClause returns null when no match', () => {
    const on = suggestOnClause(
      { fields: [{ name: 'JobID' }] },
      { fields: [{ name: 'LeadId' }] },
      't1', 't2'
    )
    expect(on).toBeNull()
  })

  it('aliasOf prefers custom alias, falls back to positional', () => {
    expect(aliasOf({ alias: 'orders' }, 0)).toBe('orders')
    expect(aliasOf({ alias: '  ' }, 2)).toBe('t3')
    expect(aliasOf({}, 1)).toBe('t2')
  })
})
