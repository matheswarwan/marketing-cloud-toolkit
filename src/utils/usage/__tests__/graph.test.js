import { describe, it, expect } from 'vitest'
import { lineageEdges } from '../match.js'
import { mapInput, buildUsageMap, reachableLineage, litSet, filterSet, useOf, deNodeId } from '../graph.js'
import { layoutUsageMap, MAP_NODE_W } from '../graphLayout.js'
import { usageMapSvg } from '../graphSvg.js'

// Raw → (stage) → Staging → (build, also reads Customers) → Orders → (report) → Report
// and Report → (loop) → Raw; a file is imported into Raw; Orders is extracted to a file.
const queries = [
  { queryDefinitionId: 'Q1', name: 'stage', targetName: 'Staging', queryText: 'SELECT * FROM Raw' },
  { queryDefinitionId: 'Q2', name: 'build', targetName: 'Orders', queryText: 'SELECT * FROM Staging s JOIN Customers c ON 1=1' },
  { queryDefinitionId: 'Q3', name: 'report', targetName: 'Report', queryText: 'SELECT * FROM Orders' },
  { queryDefinitionId: 'Q4', name: 'loop', targetName: 'Raw', queryText: 'SELECT * FROM Report' },
]
const imports = [{ name: 'load raw', importDefinitionId: 'I1', destinationObjectId: 'RAW-ID', fileNamingPattern: 'raw.csv' }]
const extracts = [{ name: 'export', dataExtractDefinitionId: 'X1', dataFields: [{ name: 'DECustomerKey', value: 'ORD' }], fileSpec: 'orders.csv' }]
const edges = lineageEdges({ queries, imports, extracts, deNameById: new Map([['raw-id', 'Raw']]), deNameByKey: new Map([['ord', 'Orders']]) })

const item = (key, kind, title, extra = {}) => ({ key, kind, title, badges: [], lines: [], ...extra })
const sections = [
  { id: 'queries', items: [
    item('300:Q2', 'SQL Query', 'build', { badges: [{ text: 'Writes', tone: 'write' }], automations: [{ name: 'Nightly', step: 2 }] }),
    item('300:Q3', 'SQL Query', 'report', { badges: [{ text: 'Reads', tone: 'read' }], automations: [] }),
  ] },
  { id: 'extracts', items: [item('73:X1', 'Data Extract', 'export', { badges: [{ text: 'Reads (extract)', tone: 'read' }] })] },
  { id: 'scripts', items: [item('423:S1', 'Script', 'Clean', { badges: [{ text: 'Named in code', tone: 'maybe' }] })] },
  { id: 'events', items: [item('e:EV1', 'Entry event', 'Orders entry', { pivot: { kind: 'event', event: { eventDefinitionKey: 'DEAudience-1' } } })] },
  { id: 'journeys', items: [
    item('j:J1', 'Journey', 'Welcome', { badges: [{ text: 'Published', tone: 'status' }], entryKeys: ['DEAudience-1'] }),
    item('j:J2', 'Journey', 'Winback', { badges: [{ text: 'Draft', tone: 'status' }], entryKeys: [] }),
  ] },
]
const input = mapInput({ de: { name: 'Orders' }, edges: reachableLineage(edges, 'Orders'), sections, extraItems: [item('300:Q1', 'SQL Query', 'stage')] })
const ids = (m) => m.nodes.map((n) => n.id).sort()
const edge = (m, s, t) => m.edges.find((e) => e.source === s && e.target === t)

describe('Where used map model', () => {
  it('draws one level of lineage around the focus, data flowing left to right', () => {
    const m = buildUsageMap(input, { depth: 1 })
    expect(m.nodes.find((n) => n.focus)).toMatchObject({ id: 'de:orders', label: 'Orders', type: 'de' })
    // Staging and Customers are read by build, which writes Orders; report reads Orders.
    expect(edge(m, 'de:staging', 'act:300:Q2')).toMatchObject({ rel: 'reads' })
    expect(edge(m, 'de:customers', 'act:300:Q2')).toMatchObject({ rel: 'reads' })
    expect(edge(m, 'act:300:Q2', 'de:orders')).toMatchObject({ rel: 'writes' })
    expect(edge(m, 'de:orders', 'act:300:Q3')).toMatchObject({ rel: 'reads' })
    expect(edge(m, 'act:300:Q3', 'de:report')).toMatchObject({ rel: 'writes' })
    expect(edge(m, 'act:73:X1', 'file:73:X1')).toMatchObject({ rel: 'file' })
    // Not yet: Raw is two levels up.
    expect(ids(m)).not.toContain('de:raw')
  })

  it('goes further with depth, stops at loops, and names boxes from the result items', () => {
    const m = buildUsageMap(input, { depth: 'all' })
    expect(ids(m)).toEqual(expect.arrayContaining(['de:raw', 'act:300:Q1', 'act:43:I1', 'file:43:I1', 'act:300:Q4']))
    const stage = m.nodes.find((n) => n.id === 'act:300:Q1')
    expect(stage).toMatchObject({ label: 'stage', type: 'query', parent: 'de:staging' })
    expect(m.nodes.find((n) => n.id === 'act:300:Q2').sub).toBe('SQL Query · Nightly, step 2')
    expect(m.nodes.find((n) => n.id === 'act:300:Q3').sub).toBe('SQL Query · Not in any automation')
    // Each node once, each edge once.
    expect(new Set(ids(m)).size).toBe(m.nodes.length)
    expect(new Set(m.edges.map((e) => e.id)).size).toBe(m.edges.length)
  })

  it('hangs other users off the focus, possible matches dashed, journeys after their entry event', () => {
    const m = buildUsageMap(input, { depth: 1 })
    expect(edge(m, 'de:orders', 'act:423:S1')).toMatchObject({ rel: 'uses', possible: true })
    expect(m.nodes.find((n) => n.id === 'act:423:S1').possible).toBe(true)
    expect(edge(m, 'de:orders', 'act:e:EV1')).toMatchObject({ rel: 'entry' })
    expect(edge(m, 'act:e:EV1', 'act:j:J1')).toMatchObject({ rel: 'entry' })
    expect(edge(m, 'de:orders', 'act:j:J1')).toBeUndefined()
    expect(edge(m, 'de:orders', 'act:j:J2')).toMatchObject({ rel: 'uses', possible: false })
    expect(m.nodes.find((n) => n.id === 'act:j:J1').sub).toBe('Journey · Published')
  })

  it('folds a long list of one type into "+N more" until it is opened', () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`423:S${i}`, 'Script', `Script ${i}`, { badges: [{ text: 'Named in code', tone: 'maybe' }] }))
    const big = mapInput({ de: { name: 'Orders' }, edges: [], sections: [{ id: 'scripts', items: many }] })
    const folded = buildUsageMap(big)
    const more = folded.nodes.find((n) => n.type === 'more')
    expect(more).toMatchObject({ label: '+5 more', sub: '5 scripts', count: 5 })
    expect(folded.nodes.filter((n) => n.type === 'script')).toHaveLength(4)
    expect(folded.hidden).toBe(5)
    const open = buildUsageMap(big, { expanded: new Set([more.id]) })
    expect(open.nodes.filter((n) => n.type === 'script')).toHaveLength(9)
    expect(open.nodes.some((n) => n.type === 'more')).toBe(false)
  })

  it('folds lineage users once, not again as direct users (live test, 2026-11-16)', () => {
    const qs = Array.from({ length: 10 }, (_, i) => ({ from: 'Orders', to: `Out${i}`, via: { kind: 'query', name: `q${i}`, id: `Q${i}` } }))
    const items = qs.map((e) => item(`300:${e.via.id}`, 'SQL Query', e.via.name, { badges: [{ text: 'Reads', tone: 'read' }] }))
    const m = buildUsageMap(mapInput({ de: { name: 'Orders' }, edges: qs, sections: [{ id: 'queries', items }] }), { depth: 1 })
    expect(m.nodes.filter((n) => n.type === 'query')).toHaveLength(4)
    expect(m.nodes.filter((n) => n.type === 'more')).toHaveLength(1)
    expect(m.hidden).toBe(6)
  })

  it('marks data views and lights a node, its neighbours and the way back to the focus', () => {
    const view = buildUsageMap(mapInput({ de: { name: '_Sent', dataView: true }, edges: [], sections: [] }))
    expect(view.nodes[0]).toMatchObject({ type: 'dataview', sub: 'Data view · checked' })

    const m = buildUsageMap(input, { depth: 'all' })
    const lit = litSet(m, 'act:300:Q1')
    expect([...lit.nodes]).toEqual(expect.arrayContaining(['act:300:Q1', 'de:raw', 'de:staging', 'act:300:Q2', deNodeId('Orders')]))
    expect(lit.nodes.has('act:300:Q3')).toBe(false)
    expect(litSet(m, null)).toBe(null)
  })
})

describe('Where used map layout', () => {
  it('puts sources left of the focus and users right of it, with a path per edge', () => {
    const m = buildUsageMap(input, { depth: 'all' })
    const l = layoutUsageMap(m)
    const x = (id) => l.nodes.find((n) => n.id === id).x
    expect(x('de:staging')).toBeLessThan(x('act:300:Q2'))
    expect(x('act:300:Q2')).toBeLessThan(x('de:orders'))
    expect(x('de:orders')).toBeLessThan(x('act:300:Q3'))
    expect(l.width).toBeGreaterThan(MAP_NODE_W * 4)
    for (const e of l.edges) expect(e.path).toMatch(/^M[\d.-]+,[\d.-]+ C/)
    // The loop Report → Raw comes back round.
    expect(l.edges.some((e) => e.back)).toBe(true)
  })
})

describe('Where used map, phase 2', () => {
  const auto = (automationId, name, step, status) => ({ automationId, name, step, status })
  const sec = [{ id: 'queries', items: [
    item('300:Q2', 'SQL Query', 'build', { badges: [{ text: 'Writes', tone: 'write' }], automations: [auto('A1', 'Nightly', 2, 'Scheduled'), auto('A2', 'Old', 1, 'Paused')] }),
    item('300:Q3', 'SQL Query', 'report', { badges: [{ text: 'Reads', tone: 'read' }], automations: [auto('A1', 'Nightly', 3, 'Scheduled'), auto('A1', 'Nightly', 5, 'Scheduled')] }),
  ] }]
  const inp = mapInput({ de: { name: 'Orders' }, edges: reachableLineage(edges, 'Orders'), sections: sec })

  it('puts automations in a band above the steps they run, paused ones marked', () => {
    const m = buildUsageMap(inp, { depth: 1 })
    expect(m.nodes.find((n) => n.id === 'auto:A1')).toMatchObject({ type: 'automation', band: true, label: 'Nightly' })
    expect(edge(m, 'auto:A1', 'act:300:Q3')).toMatchObject({ rel: 'runs', label: 'steps 3, 5' })
    expect(edge(m, 'auto:A2', 'act:300:Q2')).toMatchObject({ rel: 'runs', state: 'paused' })
    expect(m.nodes.find((n) => n.id === 'auto:A2').state).toBe('paused')
    const l = layoutUsageMap(m)
    const y = (id) => l.nodes.find((n) => n.id === id).y
    expect(y('auto:A1')).toBeLessThan(Math.min(y('act:300:Q2'), y('act:300:Q3'), y('de:orders')))
    expect(l.edges.find((e) => e.id.startsWith('auto:A1>act:300:Q3')).vertical).toBe(true)
    expect(Math.min(...l.nodes.map((n) => n.y))).toBe(24)
    // Off: no band.
    expect(buildUsageMap(inp, { depth: 1, automations: false }).nodes.some((n) => n.type === 'automation')).toBe(false)
  })

  it('draws ENT. tables as ghosts and filters lines by the key', () => {
    const ent = lineageEdges({ queries: [{ queryDefinitionId: 'Q9', name: 'shared', targetName: 'Orders', queryText: 'SELECT * FROM ENT.Master' }] })
    const m = buildUsageMap(mapInput({ de: { name: 'Orders' }, edges: ent, sections: [] }))
    expect(m.nodes.find((n) => n.id === 'de:master')).toMatchObject({ sub: 'Shared (ENT.)', ghost: expect.stringContaining('parent business unit') })
    const f = filterSet(buildUsageMap(inp, { depth: 1 }), new Set(['paused']))
    expect([...f.edges]).toEqual(['auto:A2>act:300:Q2>runs'])
    expect(filterSet(m, new Set())).toBe(null)
  })

  it('hangs items off hub boxes (profiles) and joins a shared item once', () => {
    const j = item('j:J1', 'Journey', 'Welcome')
    const m = buildUsageMap(mapInput({
      focus: { id: 'focus:p', type: 'profile', label: 'Sender profiles' },
      hubs: [{ id: 'p:1', type: 'profile', label: 'Main' }, { id: 'p:2', type: 'profile', label: 'Other' }],
      sections: [{ id: 'p:1', items: [j] }, { id: 'p:2', items: [j] }],
      uses: [useOf(j, 'journey', 'out', 'uses', { hub: 'p:1' }), useOf(j, 'journey', 'out', 'uses', { hub: 'p:2' })],
    }))
    expect(m.nodes.filter((n) => n.id === 'act:j:J1')).toHaveLength(1)
    expect(edge(m, 'hub:p:1', 'act:j:J1')).toBeTruthy()
    expect(edge(m, 'hub:p:2', 'act:j:J1')).toBeTruthy()
    expect(edge(m, 'focus:p', 'hub:p:1')).toBeTruthy()
  })

  it('makes a picture of the map, every value escaped', () => {
    const evil = mapInput({ de: { name: 'A<b>&"c' }, edges: [], sections: [{ id: 'scripts', items: [item('423:S', 'Script', '<script>x</script>', { badges: [{ tone: 'maybe' }] })] }] })
    const svg = usageMapSvg(layoutUsageMap(buildUsageMap(evil)), { title: 'Where <A> is used' })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('A&lt;b&gt;&amp;&quot;c')
    expect(svg).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('stroke-dasharray="6 4"') // the possible match
  })
})

describe('Where used map, automation lines', () => {
  it('go round boxes in the way, down the gap beside the column (live test, 2026-11-16)', () => {
    const run = (id) => [{ automationId: id, name: id, step: 1, status: 'Ready' }]
    const events = Array.from({ length: 4 }, (_, i) => item(`e:E${i}`, 'Entry event', `Event ${i}`, { automations: run(`A${i}`) }))
    const l = layoutUsageMap(buildUsageMap(mapInput({ de: { name: 'Orders' }, edges: [], sections: [{ id: 'events', items: events }] })))
    const band = l.edges.filter((e) => e.source.startsWith('auto:'))
    expect(band).toHaveLength(4)
    let gaps = 0
    for (const e of band) {
      const a = l.nodes.find((n) => n.id === e.source)
      const t = l.nodes.find((n) => n.id === e.target)
      const inWay = l.nodes.some((n) => !n.band && n.id !== t.id && n.x === t.x && n.y < t.y && n.y > a.y)
      if (inWay) {
        gaps++
        const gx = Number(/ L([\d.-]+),/.exec(e.path)[1])
        expect(gx).toBeLessThanOrEqual(t.x - 16) // in the gap left of the column…
        expect(gx).toBeGreaterThan(t.x - 80) // …not in the column before it
        expect(e.arrow).toContain(`L${t.x},${t.y + 12}`)
      } else expect(e.arrow).toContain(`L${t.x + MAP_NODE_W / 2},${t.y}`)
    }
    expect(gaps).toBe(3) // all but the top event of the column
    // Lines down one gap do not overlap.
    const lanes = band.filter((e) => e.vertical && / L/.test(e.path)).map((e) => / L([\d.-]+),/.exec(e.path)[1])
    expect(new Set(lanes).size).toBe(lanes.length)
  })
})
