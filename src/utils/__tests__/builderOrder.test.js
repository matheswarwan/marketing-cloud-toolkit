import { describe, it, expect } from 'vitest'
import { moveDE, swapDEs, joinsForOrder } from '../builderOrder.js'

const A = { id: 'a', name: 'A' }
const B = { id: 'b', name: 'B', alias: 'sub' }
const C = { id: 'c', name: 'C' }

describe('Query Builder order (feedback #90)', () => {
  it('moves and swaps, keeping each table alias', () => {
    expect(moveDE([A, B, C], 2, 0).map((d) => `${d.id}:${d.alias}`)).toEqual(['c:t3', 'a:t1', 'b:sub'])
    expect(swapDEs([A, B, C], 0, 2).map((d) => `${d.id}:${d.alias}`)).toEqual(['c:t3', 'b:sub', 'a:t1'])
    expect(moveDE([A, B], 0, 5).map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('keeps joins of pairs that stay together and turns reversed ones around', () => {
    const joins = [{ leftDeId: 'a', rightDeId: 'b', joinType: 'INNER JOIN', combinator: 'AND', conditions: [{ leftField: 'Key', operator: '>=', rightField: 'SubscriberKey' }] }]
    const [j] = joinsForOrder([B, A], joins)
    expect(j).toMatchObject({ leftDeId: 'b', rightDeId: 'a', joinType: 'INNER JOIN' })
    expect(j.conditions).toEqual([{ leftField: 'SubscriberKey', operator: '<=', rightField: 'Key' }])
    expect(joinsForOrder([A, B, C], joins)[0]).toBe(joins[0])
    expect(joinsForOrder([A, B, C], joins)[1]).toMatchObject({ leftDeId: 'b', rightDeId: 'c', conditions: [] })
  })
})
