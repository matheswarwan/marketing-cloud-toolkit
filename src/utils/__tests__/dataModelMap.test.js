import { describe, it, expect, vi } from 'vitest'
import { buildModel, toField, findSetDataExtension, deSqlName } from '../dataModel.js'
import { layoutGroupMap, cardHeight, cardFields, fieldTypeText, overviewLayout, setSql, joinSql, searchModel, MAX_FIELDS, CARD_HEAD, FIELD_ROW } from '../dataModelMap.js'

// Raw shapes as SFMC sends them (attribute and relationship shapes checked live on s10, 2026-11-17).
const attr = (id, name, extra = {}) => ({ id, name: { value: name }, storageName: name.replace(/ /g, ''), dataType: 'Text', length: 50, isPrimaryKey: false, isNullable: true, displayOrder: 1, ...extra })
const raw = [
  {
    id: 'S1', key: 'Members', name: { value: 'Members' }, storageLogicalType: 'DataExtension', isSendable: true,
    attributes: [attr('a2', 'Email', { displayOrder: 2 }), attr('a1', 'Member Key', { isPrimaryKey: true, isNullable: false, displayOrder: 3 })],
    relationships: [
      { id: 'R1', leftItem: { relationshipType: 'AttributeGroup', identifier: 'G1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'Many' }, relationshipAttributes: [{ leftAttributeID: 'c1', rightAttributeID: 'a1' }] },
    ],
  },
  {
    id: 'S2', key: 'Orders', name: { value: 'Orders' }, storageLogicalType: 'DataExtension',
    attributes: [attr('b1', 'Order Id', { isPrimaryKey: true }), attr('b2', 'Member Key'), attr('b3', 'Total', { dataType: 'Decimal', length: 0 })],
    relationships: [
      // Listed from the deeper set: the map still points it away from the group.
      { id: 'R2', leftItem: { relationshipType: 'AttributeSet', identifier: 'S2', cardinality: 'Many' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'One' }, relationshipAttributes: [{ leftAttributeID: 'b2', rightAttributeID: 'a1' }] },
    ],
  },
]
const model = buildModel(raw, [{ id: 'G1', key: '', name: 'Loyalty', description: '' }])
const group = model.groups[0]
const byId = new Map(model.sets.map((s) => [s.id.toLowerCase(), s]))

describe('data model fields', () => {
  it('keeps each attribute with its column, type and key, primary keys first', () => {
    const s = byId.get('s1')
    expect(s.fields.map((f) => f.name)).toEqual(['Member Key', 'Email'])
    expect(s.fields[0]).toMatchObject({ column: 'MemberKey', type: 'Text', length: 50, pk: true, nullable: false })
    expect(group.attributeCount).toBe(5)
    expect(toField({ id: 'x', key: 'k', dataType: 'Number', length: 0 })).toMatchObject({ name: 'k', column: 'k', length: null })
  })
  it('writes types as Data Designer does', () => {
    expect(fieldTypeText({ type: 'Text', length: 256 })).toBe('Text (256)')
    expect(fieldTypeText({ type: 'Decimal', length: null })).toBe('Decimal')
  })
})

describe('group map layout', () => {
  it('places the group and its sets left to right, every link pointing away from the group', () => {
    const m = layoutGroupMap(group)
    const x = Object.fromEntries(m.nodes.map((n) => [n.id, n.x]))
    expect(x.g1).toBeLessThan(x.s1)
    expect(x.s1).toBeLessThan(x.s2)
    const r2 = m.edges.find((e) => e.id === 'R2')
    expect(r2).toMatchObject({ source: 's1', target: 's2', sourceEnd: 'one', targetEnd: 'many', fields: 'Member Key = Member Key' })
    expect(m.edges.find((e) => e.id === 'R1')).toMatchObject({ source: 'g1', target: 's1', sourceEnd: 'one', targetEnd: 'many' })
  })
  it('sizes a card to its fields, with "+N more" past the limit', () => {
    const many = { fields: Array.from({ length: MAX_FIELDS + 3 }, (_, i) => ({ id: String(i), name: `F${i}`, hidden: false })) }
    expect(cardFields(many)).toMatchObject({ more: 3 })
    expect(cardHeight(many)).toBe(CARD_HEAD + (MAX_FIELDS + 1) * FIELD_ROW + 8)
    expect(cardHeight({ fields: [] })).toBe(CARD_HEAD + FIELD_ROW + 8)
  })
  it('spaces the overview so the bubbles do not touch', () => {
    const groups = Array.from({ length: 16 }, (_, i) => ({ id: String(i) }))
    const { size, items } = overviewLayout(groups, { bubble: 116 })
    const d = Math.hypot(items[0].x - items[1].x, items[0].y - items[1].y)
    expect(d).toBeGreaterThanOrEqual(116)
    for (const it of items) { expect(it.x - 58).toBeGreaterThanOrEqual(0); expect(it.x + 58).toBeLessThanOrEqual(size) }
  })
})

describe('queries from the data model', () => {
  it('selects a set\'s columns', () => {
    expect(setSql(byId.get('s1'), 'Members')).toBe('SELECT TOP 100\n  [MemberKey],\n  [Email]\nFROM [Members]')
    expect(setSql(byId.get('s1'), 'ENT.Members')).toContain('FROM ENT.[Members]')
  })
  it('joins two linked sets on the link\'s columns, without repeating a column name', () => {
    const r2 = model.relationships.find((r) => r.id === 'R2')
    const sql = joinSql(r2, byId, new Map([['s2', 'Orders'], ['s1', 'ENT.Members']]))
    expect(sql).toBe([
      'SELECT TOP 100', '  a.[OrderId],', '  a.[MemberKey],', '  a.[Total],', '  b.[Email]',
      'FROM [Orders] a', 'INNER JOIN ENT.[Members] b', '  ON a.[MemberKey] = b.[MemberKey]',
    ].join('\n'))
  })
  it('has no join for a link to the group', () => {
    expect(joinSql(model.relationships.find((r) => r.id === 'R1'), byId, new Map())).toBe(null)
  })
  it('names Shared data extensions through ENT.', () => {
    expect(deSqlName({ name: 'A', sourceType: 'shared' })).toBe('ENT.A')
    expect(deSqlName({ name: 'A', sourceType: 'synchronized' })).toBe('A')
  })
})

describe('finding a set\'s data extension', () => {
  it('matches by key, then by exact name, and says none for SFMC\'s own sets', async () => {
    const search = vi.fn(async () => ({ items: [{ id: 'd9', name: 'Members copy', customerKey: 'X' }, { id: 'd1', name: 'Members', customerKey: 'Members' }] }))
    expect(await findSetDataExtension('s10', byId.get('s1'), search)).toEqual({ id: 'd1', customerKey: 'Members', name: 'Members', sourceType: null })
    const shared = vi.fn(async () => ({ items: [{ id: 'd2', name: 'members', key: 'other', sourceType: 'sync' }] }))
    expect(await findSetDataExtension('s10', byId.get('s1'), shared)).toMatchObject({ id: 'd2', sourceType: 'synchronized' })
    expect(await findSetDataExtension('s10', { name: 'MobilePush Tags', key: 'PushTags' }, async () => ({ items: [] }))).toBe(null)
  })
})

describe('search', () => {
  it('finds sets by name or attribute, with their group', () => {
    expect(searchModel(model, 'order').map((r) => r.set.name)).toEqual(['Orders'])
    const byField = searchModel(model, 'total')
    expect(byField[0]).toMatchObject({ group: { name: 'Loyalty' } })
    expect(byField[0].fields.map((f) => f.name)).toEqual(['Total'])
    expect(searchModel(model, '  ')).toEqual([])
  })
})
