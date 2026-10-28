import { describe, it, expect } from 'vitest'
import { buildDEFields } from '../sfmcApi.js'

// buildDEFields takes an array of { name, type, length?, scale?, isPrimaryKey?, isNullable? }
// and maps each to a fully-specified DE field definition.
// type accepts a string ('text','number','date','boolean','email','phone','decimal')
// or a numeric SFMC type code (0–6) directly.

describe('buildDEFields', () => {
  it('returns an empty array when no columns given', () => {
    expect(buildDEFields([])).toHaveLength(0)
  })

  it('maps column objects to DE field definitions', () => {
    const fields = buildDEFields([
      { name: 'col1', type: 'text' },
      { name: 'col2', type: 'number' },
    ])
    expect(fields).toHaveLength(2)
    expect(fields[0].name).toBe('col1')
    expect(fields[0].ordinal).toBe(0)
    expect(fields[0].type).toBe(0)   // text → 0
    expect(fields[1].name).toBe('col2')
    expect(fields[1].ordinal).toBe(1)
    expect(fields[1].type).toBe(1)   // number → 1
  })

  it('resolves all named SFMC type strings', () => {
    const typeMap = { text: 0, number: 1, date: 2, boolean: 3, email: 4, phone: 5, decimal: 6 }
    for (const [typeName, typeCode] of Object.entries(typeMap)) {
      const [field] = buildDEFields([{ name: 'x', type: typeName }])
      expect(field.type, `type '${typeName}'`).toBe(typeCode)
    }
  })

  it('passes numeric type codes through unchanged', () => {
    const [field] = buildDEFields([{ name: 'dt', type: 2 }])
    expect(field.type).toBe(2)
  })

  it('defaults Text length to 4000 (SFMC max), scale to 0, isNullable to true, isPrimaryKey to false', () => {
    const [field] = buildDEFields([{ name: 'x', type: 'text' }])
    expect(field.length).toBe(4000)
    expect(field.scale).toBe(0)
    expect(field.isNullable).toBe(true)
    expect(field.isPrimaryKey).toBe(false)
  })

  it('respects explicit overrides for length, isPrimaryKey, isNullable', () => {
    const [field] = buildDEFields([{ name: 'id', type: 'text', length: 36, isPrimaryKey: true, isNullable: false }])
    expect(field.length).toBe(36)
    expect(field.isPrimaryKey).toBe(true)
    expect(field.isNullable).toBe(false)
  })

  it('sets all standard boolean flags correctly', () => {
    const [field] = buildDEFields([{ name: 'x', type: 'text' }])
    expect(field.isTemplateField).toBe(false)
    expect(field.isHidden).toBe(false)
    expect(field.isReadOnly).toBe(false)
    expect(field.updatable).toBe(true)
    expect(field.retrievable).toBe(true)
    expect(field.isActive).toBe(true)
  })

  it('assigns sequential ordinals across multiple columns', () => {
    const fields = buildDEFields([
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
      { name: 'c', type: 'text' },
    ])
    expect(fields.map(f => f.ordinal)).toEqual([0, 1, 2])
  })
})

describe('buildDEFields: Decimal precision', () => {
  it('defaults Decimal to length 18, scale 2 instead of 500', () => {
    const [f] = buildDEFields([{ name: 'amt', type: 6 }])
    expect(f.length).toBe(18)
    expect(f.scale).toBe(2)
  })

  it('keeps a valid source precision and scale', () => {
    const [f] = buildDEFields([{ name: 'amt', type: 6, length: 10, scale: 4 }])
    expect([f.length, f.scale]).toEqual([10, 4])
  })

  it('replaces an out-of-range precision such as 500', () => {
    const [f] = buildDEFields([{ name: 'amt', type: 6, length: 500, scale: 2 }])
    expect(f.length).toBe(18)
  })
})
