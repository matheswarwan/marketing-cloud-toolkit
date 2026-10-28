import { describe, it, expect } from 'vitest'
import { builderToDiagramforce } from '../diagramforce.js'

const f = (...n) => n.map((name, i) => ({ name, isPrimaryKey: i === 0, type: i === 0 ? 'Text' : 1 }))
const A = { id: 'a', name: 'Orders', alias: 'o', fields: f('OrderId', 'SubscriberKey', 'Total', 'Unused'), selectedFields: ['OrderId', 'Total'] }
const B = { id: 'b', name: '_Subscribers', isDataView: true, alias: 's', fields: f('SubscriberKey', 'EmailAddress'), selectedFields: [] }
const state = {
  selectedDEs: [A, B],
  joins: [{ leftDeId: 'a', rightDeId: 'b', joinType: 'LEFT JOIN', conditions: [{ leftField: 'SubscriberKey', operator: '=', rightField: 'SubscriberKey' }] }],
  where: { combinator: 'AND', conditions: [{ alias: 's', field: 'EmailAddress', operator: 'LIKE', value: '%x' }] },
  queryOptions: { computedColumns: [{ id: 'u', expression: 'UPPER(s.[EmailAddress])', alias: 'Mail' }] },
  layout: {},
}

describe('Open in Diagramforce', () => {
  it('data model: a card per table with the fields used, joins as field lines', () => {
    const d = builderToDiagramforce(state, { mode: 'model' })
    expect(d).toMatchObject({ version: 1, diagramType: 'datamodel' })
    const cards = d.graph.cells.filter((c) => c.type === 'sf.DataObject')
    expect(cards.map((c) => c.objectName)).toEqual(['Orders (o)', '_Subscribers (s)'])
    expect(cards[0].fields.map((x) => x.apiName)).toEqual(['OrderId', 'SubscriberKey', 'Total'])
    expect(cards[0].fields[0]).toMatchObject({ keyType: 'pk', type: 'Text' })
    expect(cards[1].fields.map((x) => x.apiName)).toEqual(['SubscriberKey', 'EmailAddress'])
    const link = d.graph.cells.find((c) => c.type === 'standard.Link')
    expect(link.source.port).toBe(`field-right-${cards[0].fields[1].fid}`)
    expect(link.target.port).toBe(`field-left-${cards[1].fields[0].fid}`)
    expect(link.labels[0].attrs.text.text).toBe('LEFT JOIN')
    expect(builderToDiagramforce(state, { allFields: true }).graph.cells[0].fields).toHaveLength(4)
  })

  it('lineage: output columns linked from the fields they read', () => {
    const d = builderToDiagramforce(state, { mode: 'lineage' })
    expect(d.diagramType).toBe('datamapping')
    const out = d.graph.cells.find((c) => c.id === 'output')
    expect(out.fields.map((x) => x.apiName)).toEqual(['OrderId', 'Total', 'Mail'])
    const maps = d.graph.cells.filter((c) => c.linkKind === 'mapping')
    expect(maps).toHaveLength(3)
    expect(maps[2]).toMatchObject({ mappingType: 'Formula', expressionRule: 'UPPER(s.[EmailAddress])', target: { id: 'output', port: 'field-left-o2' } })
  })
})
