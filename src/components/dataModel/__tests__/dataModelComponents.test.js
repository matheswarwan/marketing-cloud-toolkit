import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { buildModel } from '@/utils/dataModel.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
const start = vi.fn()
vi.mock('@/composables/useUsage.js', () => ({ useUsage: () => ({ start }) }))
const search = vi.hoisted(() => ({ items: [] }))
vi.mock('@/utils/sfmcApi.js', () => ({ sfmcFetch: vi.fn(), searchDEsAllSources: vi.fn(async () => ({ items: search.items })) }))
vi.mock('@vue-flow/core', async () => {
  const { ref, h, defineComponent } = await import('vue')
  return {
    useVueFlow: () => ({ viewport: ref({ x: 0, y: 0, zoom: 1 }), fitView: vi.fn(), setViewport: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), setCenter: vi.fn(), onNodesInitialized: () => {} }),
    VueFlow: defineComponent({
      props: ['nodes', 'edges'], emits: ['paneClick'],
      setup: (props, { slots }) => () => h('div', [
        ...props.nodes.map((node) => h('div', { key: node.id }, slots[`node-${node.type}`]?.(node))),
        ...props.edges.map((e) => h('i', { key: e.id, 'data-edge': e.id, 'data-lit': String(e.data.lit) })),
        slots.default?.(),
      ]),
    }),
    Handle: { template: '<span />' }, Position: { Left: 'left', Right: 'right' },
    BaseEdge: { template: '<path />' }, EdgeLabelRenderer: { template: '<div><slot /></div>' }, getBezierPath: () => ['M0,0', 0, 0],
  }
})
vi.mock('@vue-flow/minimap', () => ({ MiniMap: { template: '<div />' } }))

const attr = (id, name, extra = {}) => ({ id, name: { value: name }, storageName: name.replace(/ /g, ''), dataType: 'Text', length: 50, isNullable: true, ...extra })
const model = buildModel([
  { id: 'S1', key: 'Members', name: { value: 'Members' }, storageLogicalType: 'DataExtension', attributes: [attr('a1', 'Member Key', { isPrimaryKey: true })],
    relationships: [{ id: 'R1', leftItem: { relationshipType: 'AttributeGroup', identifier: 'G1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'Many' }, relationshipAttributes: [] }] },
  { id: 'S2', key: 'Orders', name: { value: 'Orders' }, storageLogicalType: 'DataExtension', attributes: [attr('b1', 'Member Key')],
    relationships: [{ id: 'R2', leftItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S2', cardinality: 'Many' }, relationshipAttributes: [{ leftAttributeID: 'a1', rightAttributeID: 'b1' }] }] },
], [{ id: 'G1', key: '', name: 'Loyalty', description: '' }])
const set = (id) => model.sets.find((s) => s.id === id)

beforeEach(() => { push.mockClear(); start.mockClear(); search.items = [] })

describe('DataModelMap', () => {
  it('draws a card per set with its attributes; hover lights its links; click picks it', async () => {
    const w = mount((await import('../DataModelMap.vue')).default, { props: { group: model.groups[0] } })
    const card = w.find('[data-dm-set="s2"]')
    expect(card.text()).toContain('Orders')
    expect(card.text()).toContain('Member Key')
    await card.trigger('focus')
    await new Promise((r) => setTimeout(r, 150))
    expect(w.find('[data-edge="R2"]').attributes('data-lit')).toBe('true')
    expect(w.find('[data-edge="R1"]').attributes('data-lit')).toBe('false')
    await card.trigger('click')
    expect(w.emitted('select')[0]).toEqual(['s2'])
  })
})

describe('DataModelSetPanel', () => {
  const mountPanel = async (id) => mount((await import('../DataModelSetPanel.vue')).default, { props: { stack: 's10', set: set(id), model } })

  it('opens the set\'s data extension in Preview data', async () => {
    search.items = [{ id: 'de1', name: 'Members', customerKey: 'Members' }]
    const w = await mountPanel('S1')
    await w.find('[data-dm-action="contents"]').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/data-extensions/preview', query: { id: 'de1', key: 'Members', name: 'Members' } })
  })

  it('says so when a set has no data extension (SFMC\'s own data)', async () => {
    const w = await mountPanel('S1')
    await w.find('[data-dm-action="contents"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(w.find('[data-dm-no-de]').exists()).toBe(true)
  })

  it('queries the set, and both linked sets joined on the link', async () => {
    search.items = [{ id: 'de1', name: 'Members', customerKey: 'Members' }, { id: 'de2', name: 'Orders', customerKey: 'Orders' }]
    const w = await mountPanel('S2')
    await w.find('[data-dm-action="query"]').trigger('click')
    await flushPromises()
    expect(push.mock.calls[0][0]).toEqual({ path: '/queries/workspace', query: { sql: 'SELECT TOP 100\n  [MemberKey]\nFROM [Orders]' } })
    await w.find('[data-dm-join]').trigger('click')
    await flushPromises()
    expect(push.mock.calls[1][0].query.sql).toContain('FROM [Members] a\nINNER JOIN [Orders] b\n  ON a.[MemberKey] = b.[MemberKey]')
  })

  it('checks where the set is used, and jumps to a linked set', async () => {
    search.items = [{ id: 'de1', name: 'Members', customerKey: 'Members' }]
    const w = await mountPanel('S1')
    await w.find('[data-dm-action="where-used"]').trigger('click')
    await flushPromises()
    expect(start).toHaveBeenCalledWith('s10', { kind: 'de', de: { id: 'de1', name: 'Members', customerKey: 'Members' } })
    const links = w.findAll('[data-dm-link]')
    expect(links.map((l) => l.text()).join(' ')).toContain('Loyalty')
    await links.find((l) => l.text().includes('Orders')).find('button').trigger('click')
    expect(w.emitted('select')[0]).toEqual(['s2'])
  })
})
