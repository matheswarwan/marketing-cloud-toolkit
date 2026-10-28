import { describe, it, expect } from 'vitest'
import { canvasEdges, autoLayout, visibleRows, joinedFields, parseHandle, fieldHandle, nextPosition, FOLD_AT } from '../builderCanvas.js'
import { addJoinCondition, orderFromRoot, joinsForOrder, graphToModel } from '../builderOrder.js'
import { buildSqlFromSelections } from '../sqlBuilder.js'

const f = (...names) => names.map((name) => ({ name }))
const A = { id: 'a', name: 'Orders', fields: f('OrderId', 'SubscriberKey', 'Total') }
const B = { id: 'b', name: 'Customers', fields: f('SubscriberKey', 'Email') }
const C = { id: 'c', name: 'Lines', fields: f('OrderId', 'Sku') }

describe('visual builder: joins drawn on the canvas', () => {
  it('a line between two cards becomes a condition of the later table', () => {
    let joins = joinsForOrder([A, B], [])
    joins = addJoinCondition([A, B], joins, { deId: 'b', field: 'SubscriberKey' }, { deId: 'a', field: 'SubscriberKey' })
    expect(joins).toHaveLength(1)
    expect(joins[0]).toMatchObject({ leftDeId: 'a', rightDeId: 'b' })
    expect(joins[0].conditions).toEqual([{ leftField: 'SubscriberKey', operator: '=', rightField: 'SubscriberKey', conn: 'AND' }])
    // The same line again adds nothing.
    expect(addJoinCondition([A, B], joins, { deId: 'a', field: 'SubscriberKey' }, { deId: 'b', field: 'SubscriberKey' })[0].conditions).toHaveLength(1)
  })

  it('joins form a tree: C joins A, not the table before it', () => {
    let joins = joinsForOrder([A, B, C], [])
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'SubscriberKey' }, { deId: 'b', field: 'SubscriberKey' })
    joins = addJoinCondition([A, B, C], joins, { deId: 'c', field: 'OrderId' }, { deId: 'a', field: 'OrderId' })
    const sql = buildSqlFromSelections([A, B, C], joins)
    expect(sql).toContain('JOIN [Lines] AS t3 ON t1.[OrderId] = t3.[OrderId]')
    expect(joinsForOrder([A, B, C], joins)[1]).toBe(joins[1])
  })

  it('a third table in a condition is named by its own alias', () => {
    let joins = joinsForOrder([A, B, C], [])
    joins = addJoinCondition([A, B, C], joins, { deId: 'b', field: 'SubscriberKey' }, { deId: 'c', field: 'Sku' })
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'OrderId' }, { deId: 'c', field: 'OrderId' })
    expect(joins[1].conditions[1]).toMatchObject({ leftDeId: 'a', leftField: 'OrderId' })
    expect(buildSqlFromSelections([A, B, C], joins)).toContain('ON t2.[SubscriberKey] = t3.[Sku]\n    AND t1.[OrderId] = t3.[OrderId]')
  })

  it('making another table the FROM table keeps every join, turned around', () => {
    let joins = joinsForOrder([A, B, C], [])
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'SubscriberKey' }, { deId: 'b', field: 'SubscriberKey' })
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'OrderId' }, { deId: 'c', field: 'OrderId' })
    const list = orderFromRoot([A, B, C], joins, 'c')
    expect(list.map((d) => d.id)).toEqual(['c', 'a', 'b'])
    const next = joinsForOrder(list, joins)
    expect(next[0]).toMatchObject({ leftDeId: 'c', rightDeId: 'a' })
    expect(next[0].conditions[0]).toMatchObject({ leftField: 'OrderId', rightField: 'OrderId' })
    expect(next[1]).toMatchObject({ leftDeId: 'a', rightDeId: 'b' })
    const sql = buildSqlFromSelections(list, next)
    expect(sql).toContain('FROM [Lines] AS t3')
  })

  it('draws one line per condition, a pill on the first, header lines for empty joins', () => {
    let joins = joinsForOrder([A, B, C], [])
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'SubscriberKey' }, { deId: 'b', field: 'SubscriberKey' })
    joins = addJoinCondition([A, B, C], joins, { deId: 'a', field: 'OrderId' }, { deId: 'b', field: 'Email' })
    const edges = canvasEdges([A, B, C], joins, { a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, c: { x: -400, y: 0 } })
    expect(edges.map((e) => [e.source, e.target, e.sourceHandle, e.targetHandle, e.data.label])).toEqual([
      ['a', 'b', fieldHandle(1, 'r'), fieldHandle(0, 'l'), true],
      ['a', 'b', fieldHandle(0, 'r'), fieldHandle(1, 'l'), false],
      ['b', 'c', 'h-l', 'h-r', true],
    ])
    expect(edges[2].data.missing).toBe(true)
    expect(parseHandle('f12-l')).toBe(12)
    expect(parseHandle('h-l')).toBe(null)
  })

  it('big cards show joined, ticked and key fields first, and joined ones always', () => {
    const many = { id: 'm', fields: Array.from({ length: 40 }, (_, i) => ({ name: `F${i}`, isPrimaryKey: i === 30 })), selectedFields: ['F35'] }
    const v = visibleRows(many, new Set(['F39']))
    expect(v.rows).toHaveLength(FOLD_AT)
    expect(v.rows.map((r) => r.field.name)).toEqual(expect.arrayContaining(['F39', 'F35', 'F30', 'F0']))
    expect(v.hidden).toBe(40 - FOLD_AT)
    expect(visibleRows(many, new Set(['F39']), { search: 'f1' }).rows.map((r) => r.field.name)).toContain('F39')
    expect(visibleRows(many, new Set(), { showAll: true }).rows).toHaveLength(40)
    expect([...joinedFields([A, B], [{ leftDeId: 'a', rightDeId: 'b', conditions: [{ leftField: 'Total', rightField: 'Email' }] }]).get('b')]).toEqual(['Email'])
  })

  it('auto layout puts joined tables left to right', () => {
    const joins = [{ leftDeId: 'a', rightDeId: 'b' }, { leftDeId: 'a', rightDeId: 'c' }]
    const pos = autoLayout([A, B, C], joins)
    expect(pos.b.x).toBeGreaterThan(pos.a.x)
    expect(pos.c.x).toBe(pos.b.x)
    expect(pos.b.y).not.toBe(pos.c.y)
    expect(nextPosition({ a: { x: 10, y: 5 } }).x).toBeGreaterThan(10)
  })

  it('old visual records turn into the shared model', () => {
    const m = graphToModel([A, B], [{ id: 'b', x: 300, y: 10, data: B }, { id: 'a', x: 0, y: 0, data: A }],
      [{ source: 'b', target: 'a', data: { joinType: 'INNER JOIN', conditions: [{ leftField: 'SubscriberKey', rightField: 'SubscriberKey' }] } }])
    expect(m.selectedDEs.map((d) => d.id)).toEqual(['b', 'a'])
    expect(m.joins[0]).toMatchObject({ leftDeId: 'b', rightDeId: 'a', joinType: 'INNER JOIN' })
    expect(m.layout.b).toEqual({ x: 300, y: 10 })
  })
})

import { smartAlias } from '../builderOrder.js'
describe('table aliases (feedback #150)', () => {
  it('short, from the name, unique and never a keyword', () => {
    expect(smartAlias('Customer Master')).toBe('cm')
    expect(smartAlias('Orders')).toBe('ord')
    expect(smartAlias('Welcome_Journey_DE')).toBe('wjd')
    expect(smartAlias('ENT.[Shared Contacts]')).toBe('sc')
    expect(smartAlias('_Subscribers')).toBe('sub')
    expect(smartAlias('_Sent', ['s'])).toBe('s2')
    expect(smartAlias('Order Number')).toBe('on1')
    expect(smartAlias('Orders', ['ord', 'ord2'])).toBe('ord3')
    expect(smartAlias('123')).toBe('t')
  })
})
