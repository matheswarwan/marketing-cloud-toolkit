import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mapInput } from '@/utils/usage/graph.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
const flow = vi.hoisted(() => ({ fit: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), setViewport: vi.fn(), setCenter: vi.fn(), initialized: null }))
vi.mock('@vue-flow/core', async () => {
  const { ref, h, defineComponent } = await import('vue')
  return {
    useVueFlow: () => ({
      viewport: ref({ x: 0, y: 0, zoom: 1 }), fitView: flow.fit, zoomIn: flow.zoomIn, zoomOut: flow.zoomOut,
      zoomTo: flow.zoomTo, setViewport: flow.setViewport, getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      onNodesInitialized: (cb) => { flow.initialized = cb }, onPaneReady: () => {}, setCenter: flow.setCenter,
    }),
    VueFlow: defineComponent({
      props: ['nodes', 'edges'], emits: ['paneClick'],
      setup: (props, { slots }) => () => h('div', { class: 'flow-test' }, [
        ...props.nodes.map((node) => h('div', { key: node.id }, slots['node-usage']?.(node))),
        ...props.edges.map((e) => h('i', { key: e.id, 'data-edge': e.id, 'data-lit': String(e.data.lit), 'data-dim': String(e.data.dim) })),
        slots.default?.(),
      ]),
    }),
    Handle: { template: '<span />' }, Position: { Left: 'left', Right: 'right' },
    BaseEdge: { template: '<path />' }, EdgeLabelRenderer: { template: '<div><slot /></div>' },
  }
})
vi.mock('@vue-flow/minimap', () => ({ MiniMap: { template: '<div data-minimap />' } }))

const stubs = { DERowCount: true, StatusBadge: true, ActivityIcon: true, CodeView: true, Teleport: true }
const item = (key, kind, title, extra = {}) => ({ key, kind, title, badges: [], lines: [], ...extra })
const edges = [
  { from: 'Raw', to: 'Orders', via: { kind: 'query', name: 'build', id: 'Q1' } },
  { from: 'Orders', to: 'Report', via: { kind: 'query', name: 'report', id: 'Q2' } },
]
const scripts = Array.from({ length: 8 }, (_, i) => item(`423:S${i}`, 'Script', `Script ${i}`, { badges: [{ text: 'Named in code', tone: 'maybe' }] }))
const input = mapInput({
  de: { name: 'Orders' }, edges,
  sections: [
    { id: 'queries', items: [item('300:Q1', 'SQL Query', 'build', { badges: [{ text: 'Writes', tone: 'write' }], lines: ['Modified today'] })] },
    { id: 'scripts', items: scripts },
  ],
})
const node = (w, id) => w.find(`[data-map-node="${id}"]`)

describe('Where used map', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

  it('draws the checked DE, its lineage and folded users, and opens a "+N more" box', async () => {
    const w = mount((await import('../UsageMap.vue')).default, { props: { input }, global: { stubs } })
    vi.useFakeTimers()
    flow.initialized()
    expect(flow.fit).toHaveBeenCalledTimes(1) // fits once vue-flow has measured the boxes
    vi.advanceTimersByTime(400)
    expect(flow.fit).toHaveBeenCalledTimes(2) // and once more, in case the pane was not ready
    flow.initialized()
    vi.advanceTimersByTime(400)
    expect(flow.fit).toHaveBeenCalledTimes(2) // not again without a change
    vi.useRealTimers()
    expect(node(w, 'de:orders').attributes('aria-label')).toContain('the one checked')
    expect(node(w, 'de:raw').exists()).toBe(true)
    expect(node(w, 'act:300:Q1').text()).toContain('build')
    expect(w.findAll('[data-map-node^="act:423:"]')).toHaveLength(4)
    expect(w.text()).toContain('4 more folded away')
    await node(w, 'more:de:orders:down:script').trigger('click')
    expect(w.findAll('[data-map-node^="act:423:"]')).toHaveLength(8)
    expect(w.text()).not.toContain('folded away')
    w.unmount()
  })

  it('shows a box\'s details on click and lights its links on hover', async () => {
    vi.useFakeTimers()
    const w = mount((await import('../UsageMap.vue')).default, { props: { input }, global: { stubs } })
    await node(w, 'act:300:Q1').trigger('click')
    expect(w.find('.usage-map-details').text()).toContain('Modified today')
    await node(w, 'de:raw').trigger('mouseenter')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(w.find('[data-edge="de:raw>act:300:Q1>reads"]').attributes('data-lit')).toBe('true')
    expect(w.find('[data-edge="de:orders>act:300:Q2>reads"]').attributes('data-dim')).toBe('true')
    vi.useRealTimers()
    w.unmount()
  })

  it('centres on another DE by double-click or from its details, and changes depth', async () => {
    const w = mount((await import('../UsageMap.vue')).default, { props: { input }, global: { stubs } })
    await node(w, 'de:raw').trigger('dblclick')
    expect(w.emitted('follow')).toEqual([[{ kind: 'de', de: { name: 'Raw' } }]])
    await node(w, 'de:report').trigger('click')
    await w.find('.usage-map-details button[title="Where is Report used?"]').trigger('click')
    expect(w.emitted('follow')[1]).toEqual([{ kind: 'de', de: { name: 'Report' } }])
    await node(w, 'de:orders').trigger('dblclick')
    expect(w.emitted('follow')).toHaveLength(2) // the checked one is already the centre

    await w.findAll('button').find((b) => b.text() === 'All').trigger('click')
    expect(localStorage.getItem('toolkit_usageMapDepth')).toBe('all')
    w.unmount()
  })
})
