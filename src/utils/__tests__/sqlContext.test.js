import { describe, it, expect } from 'vitest'
import { completionContext, referencedTables } from '../sqlContext.js'

// `|` marks the cursor.
function ctx(text) {
  const pos = text.indexOf('|')
  return completionContext(text.replace('|', ''), pos)
}

describe('referencedTables', () => {
  it('finds tables and aliases after FROM and JOIN', () => {
    const t = referencedTables('SELECT * FROM _Sent s INNER JOIN [My DE] AS d ON d.k = s.k LEFT JOIN ENT.[Shared DE] e ON 1=1 JOIN Plain WHERE x = 1')
    expect(t.map(x => [x.name, x.alias])).toEqual([
      ['_Sent', 's'], ['[My DE]', 'd'], ['ENT.[Shared DE]', 'e'], ['Plain', null],
    ])
  })

  it('skips table functions and subqueries', () => {
    const t = referencedTables('SELECT v.value FROM x CROSS APPLY STRING_SPLIT(x.a, \',\') v JOIN (SELECT 1 AS a) q ON 1=1')
    expect(t.map(x => x.name)).toEqual(['x'])
  })
})

describe('completionContext', () => {
  it('wants a table after FROM and JOIN', () => {
    expect(ctx('SELECT a FROM Cont|')).toMatchObject({ kind: 'table', prefix: 'Cont' })
    expect(ctx('SELECT a FROM x JOIN |')).toMatchObject({ kind: 'table', prefix: '' })
    expect(ctx('SELECT a FROM [My D|')).toMatchObject({ kind: 'table', prefix: 'My D' })
  })

  it('wants a table after a comma in the FROM list', () => {
    expect(ctx('SELECT a, b FROM x, y|')).toMatchObject({ kind: 'table', prefix: 'y' })
    expect(ctx('SELECT a, b|')).toMatchObject({ kind: 'column', prefix: 'b' })
  })

  it('wants a member after alias dot', () => {
    expect(ctx('SELECT s.Ev| FROM _Sent s')).toMatchObject({ kind: 'member', qualifier: 's', prefix: 'Ev' })
    expect(ctx('SELECT [d].| FROM [My DE] d')).toMatchObject({ kind: 'member', qualifier: 'd', prefix: '' })
  })

  it('wants columns elsewhere', () => {
    expect(ctx('SELECT a FROM x WHERE Sub|')).toMatchObject({ kind: 'column', prefix: 'Sub' })
  })

  it('suggests values inside a string compared with a field', () => {
    expect(ctx("SELECT a FROM _Subscribers s WHERE s.Status = 'ac|")).toMatchObject({ kind: 'value', prefix: 'ac', field: { qualifier: 's', name: 'Status' } })
    expect(ctx("SELECT a FROM x WHERE Status IN ('active', '|")).toMatchObject({ kind: 'value', prefix: '', field: { qualifier: null, name: 'Status' } })
  })

  it('suggests nothing in comments and plain strings', () => {
    expect(ctx('SELECT a -- FROM |')).toMatchObject({ kind: 'none' })
    expect(ctx("SELECT 'FROM |' AS x")).toMatchObject({ kind: 'none' })
  })
})
