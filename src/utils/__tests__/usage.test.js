import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  tablesInSql, matchQuery, matchField, buildActivityIndex, deRefsInCode, codeRefsToDE, contentBlockRefs, assetText,
  assetPlacesBlock, findValues, findPathMentions, collectProfileRefs, lineageEdges, lineageTree,
} from '../usage/match.js'

const names = (sql) => tablesInSql(sql).map((t) => t.name).sort()

describe('tablesInSql', () => {
  it('finds FROM and JOIN tables, brackets and aliases', () => {
    expect(names('SELECT a.Id FROM [My Orders] a INNER JOIN Customers c ON c.Id = a.Id')).toEqual(['Customers', 'My Orders'])
  })

  it('finds tables in subqueries and comma joins', () => {
    expect(names('SELECT Id FROM A WHERE Id IN (SELECT Id FROM [Sub DE])')).toEqual(['A', 'Sub DE'])
    expect(names('SELECT x.Id FROM A x, B y WHERE x.Id = y.Id')).toEqual(['A', 'B'])
  })

  it('marks ENT. references', () => {
    expect(tablesInSql('SELECT * FROM ENT.[Shared One] s JOIN Local l ON 1=1')).toEqual(
      expect.arrayContaining([{ name: 'Shared One', ent: true }, { name: 'Local', ent: false }]))
    expect(tablesInSql('SELECT * FROM [ENT].Shared2')[0]).toEqual({ name: 'Shared2', ent: true })
  })

  it('ignores comments and string literals', () => {
    expect(names("SELECT 'FROM Fake' AS t FROM Real -- JOIN Old\n/* FROM Gone */")).toEqual(['Real'])
  })

  it('does not match a longer name', () => {
    expect(names('SELECT * FROM Orders_Archive')).toEqual(['Orders_Archive'])
  })
})

describe('matchQuery', () => {
  const de = { id: 'DE-1', name: 'Orders', customerKey: 'ORD_KEY' }

  it('writes when the target key or id matches', () => {
    expect(matchQuery({ targetKey: 'ord_key', queryText: 'SELECT 1 FROM X' }, de)).toEqual({ writes: true, reads: false, viaEnt: false })
    expect(matchQuery({ targetId: 'de-1', queryText: '' }, de)?.writes).toBe(true)
  })

  it('does not count a same-named target with a different key', () => {
    expect(matchQuery({ targetKey: 'OTHER', targetName: 'Orders', queryText: 'SELECT 1 FROM X' }, de)).toBeNull()
  })

  it('falls back to the target name when the query has no key or id', () => {
    expect(matchQuery({ targetName: 'orders', queryText: '' }, de)?.writes).toBe(true)
  })

  it('reads by name, case-insensitive, and not on a longer name', () => {
    expect(matchQuery({ targetKey: 'T', queryText: 'select * from orders o' }, de)).toEqual({ writes: false, reads: true, viaEnt: false })
    expect(matchQuery({ targetKey: 'T', queryText: 'SELECT * FROM ENT.Orders' }, de)?.viaEnt).toBe(true)
    expect(matchQuery({ targetKey: 'T', queryText: 'SELECT * FROM Orders_Archive' }, de)).toBeNull()
  })
})

describe('buildActivityIndex', () => {
  it('indexes every activity by object id with its step and type', () => {
    const index = buildActivityIndex([
      { id: 'A1', steps: [{ step: 1, name: 'Load', activities: [{ objectTypeId: 300, activityObjectId: 'Q-1', name: 'Q one' }, { objectTypeId: 423, activityObjectId: 'S-1' }] },
        { step: 2, activities: [{ objectTypeId: 300, activityObjectId: 'q-2' }] }] },
      { id: 'A2', steps: [{ activities: [{ objectTypeId: '300', activityObjectId: 'Q-1' }] }] },
    ])
    expect(index.get('q-1')).toEqual([
      { automationId: 'A1', step: 1, stepName: 'Load', objectTypeId: 300, activityName: 'Q one' },
      { automationId: 'A2', step: 1, stepName: '', objectTypeId: 300, activityName: '' },
    ])
    expect(index.get('q-2')[0]).toMatchObject({ automationId: 'A1', step: 2 })
    expect(index.get('s-1')[0]).toMatchObject({ objectTypeId: 423 })
  })
})

describe('matchQuery with a DE known only by name', () => {
  it('matches the target by name', () => {
    expect(matchQuery({ targetKey: 'K', targetName: 'Orders', queryText: 'SELECT 1 FROM X' }, { name: 'orders' })?.writes).toBe(true)
  })
  it('never writes to a data view', () => {
    expect(matchQuery({ targetName: '_Sent', queryText: 'SELECT * FROM _Sent' }, { name: '_Sent', dataView: true })).toEqual({ writes: false, reads: true, viaEnt: false })
  })
})

describe('matchField', () => {
  const de = { id: 'D', name: 'Orders', customerKey: 'ORD' }
  it('reads a field qualified by the DE alias', () => {
    expect(matchField({ targetKey: 'X', queryText: 'SELECT o.Amount, c.Email FROM Orders o JOIN Customers c ON c.Id = o.CustId' }, de, 'Amount')).toEqual({ writes: false, reads: 'yes' })
  })
  it('does not count the same field name on another table', () => {
    expect(matchField({ targetKey: 'X', queryText: 'SELECT c.Amount FROM Orders o JOIN Customers c ON c.Id = o.CustId' }, de, 'Amount')).toBeNull()
  })
  it('says maybe for an unqualified field with several tables, yes with one', () => {
    expect(matchField({ targetKey: 'X', queryText: 'SELECT Amount FROM Orders o JOIN Customers c ON 1=1' }, de, 'amount')?.reads).toBe('maybe')
    expect(matchField({ targetKey: 'X', queryText: 'SELECT [Amount] FROM [Orders]' }, de, 'Amount')?.reads).toBe('yes')
    expect(matchField({ targetKey: 'X', queryText: 'SELECT * FROM Orders' }, de, 'Amount')?.reads).toBe('all')
  })
  it('writes when the query targets the DE and selects the column', () => {
    expect(matchField({ targetKey: 'ORD', queryText: 'SELECT s.Total AS Amount FROM Staging s' }, de, 'Amount')).toEqual({ writes: true, reads: null })
    expect(matchField({ targetKey: 'ORD', queryText: 'SELECT s.Total FROM Staging s' }, de, 'Amount')).toBeNull()
  })
})

describe('code references', () => {
  const code = `%%[ SET @r = LookupRows("Orders", "Id", @id)
    SET @v = Lookup('ENT.Shared Prefs', "Opt", "Key", @k)
    UpsertData("Log", 1, "Id", @id) ]%%
    <script runat="server">var de = DataExtension.Init("ORD_KEY"); Platform.Function.InsertData("Audit", ["A"], [1]);</script>
    %%=ContentBlockByKey("hdr-1")=%% %%=ContentBlockById(4567)=%% %%=ContentBlockByName("Content Builder\\Shared\\Footer")=%%`
  it('finds DEs named in AMPscript and SSJS', () => {
    expect(deRefsInCode(code).map((r) => r.ref)).toEqual(['Orders', 'Shared Prefs', 'Log', 'Audit', 'ORD_KEY'])
  })
  it('matches a DE by name or key', () => {
    expect(codeRefsToDE(code, { name: 'orders', customerKey: 'ORD_KEY' }).map((r) => r.fn)).toEqual(['LookupRows', 'DataExtension.Init'])
    expect(codeRefsToDE(code, { name: 'Orders_Archive' })).toEqual([])
  })
  it('finds content blocks by key, ID and name', () => {
    expect(contentBlockRefs(code, { id: 1, customerKey: 'HDR-1', name: 'x' })).toEqual(['ContentBlockByKey'])
    expect(contentBlockRefs(code, { id: 4567, customerKey: 'k', name: 'x' })).toEqual(['ContentBlockByID'])
    expect(contentBlockRefs(code, { id: 2, customerKey: 'k', name: 'footer' })).toEqual(['ContentBlockByName'])
  })
  it('collects text from every view, slot and block, and finds placed blocks', () => {
    const asset = { content: 'A', views: { html: { content: 'B', slots: { s1: { content: 'C', blocks: { b1: { id: 99, assetType: { id: 197 }, content: 'D' } } } } }, subjectline: { content: 'E' } } }
    expect(assetText(asset).split('\n').sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(assetPlacesBlock({ slots: asset.views.html.slots }, 99)).toBe(true)
    expect(assetPlacesBlock({ slots: asset.views.html.slots }, 98)).toBe(false)
  })
})

describe('JSON helpers', () => {
  const j = { activities: [{ configurationArguments: { triggeredSend: { emailId: 123, senderProfileId: 'SP1', sendClassification: { id: 'SC1', name: 'Commercial' } } } },
    { arguments: { criteria: '<Condition Key="Contact.Attribute.Orders.Amount" Operator="GreaterThan">' } }] }
  it('finds values, optionally under matching keys', () => {
    expect(findValues(j, [123])).toEqual(['activities.0.configurationArguments.triggeredSend.emailId'])
    expect(findValues(j, ['123'], /sender/i)).toEqual([])
  })
  it('finds DE and field names in criteria paths', () => {
    expect(findPathMentions(j, 'Orders')).toHaveLength(1)
    expect(findPathMentions(j, 'Orders', 'amount')).toHaveLength(1)
    expect(findPathMentions(j, 'Orders', 'Total')).toHaveLength(0)
    expect(findPathMentions(j, 'Order')).toHaveLength(0)
  })
  it('collects profile references with names where present', () => {
    expect(collectProfileRefs(j, /^senderProfile(Id)?$/i)).toEqual([{ id: 'SP1', name: '' }])
    expect(collectProfileRefs(j, /^sendClassification(Id)?$/i)).toEqual([{ id: 'SC1', name: 'Commercial' }])
  })
})

describe('lineage', () => {
  const queries = [
    { queryDefinitionId: 'Q1', name: 'stage', targetName: 'Staging', targetKey: 'STG', queryText: 'SELECT * FROM Raw' },
    { queryDefinitionId: 'Q2', name: 'build', targetName: 'Orders', targetKey: 'ORD', queryText: 'SELECT * FROM Staging s JOIN Customers c ON 1=1' },
    { queryDefinitionId: 'Q3', name: 'report', targetName: 'Report', queryText: 'SELECT * FROM Orders' },
    { queryDefinitionId: 'Q4', name: 'loop', targetName: 'Raw', queryText: 'SELECT * FROM Report' },
  ]
  const imports = [{ name: 'load raw', importDefinitionId: 'I1', destinationObjectId: 'RAW-ID', fileNamingPattern: 'raw_%%Year%%.csv' }]
  const extracts = [{ name: 'export', dataExtractDefinitionId: 'X1', dataFields: [{ name: 'DECustomerKey', value: 'ORD' }], fileSpec: 'orders.csv' }]
  const edges = lineageEdges({ queries, imports, extracts, deNameById: new Map([['raw-id', 'Raw']]), deNameByKey: new Map([['ord', 'Orders']]) })

  it('follows data upstream through queries and imports, stopping at loops', () => {
    const up = lineageTree(edges, 'Orders', 'up')
    expect(up.children.map((c) => [c.name, c.via.name])).toEqual([['Staging', 'build'], ['Customers', 'build']])
    const raw = up.children[0].children[0]
    expect(raw.name).toBe('Raw')
    expect(raw.children.map((c) => [c.name, c.via.kind])).toEqual([['Report', 'query'], [null, 'import']])
    expect(raw.children[0].children[0]).toMatchObject({ name: 'Orders', cycle: true })
  })
  it('follows data downstream to queries and extracts', () => {
    const down = lineageTree(edges, 'Orders', 'down')
    expect(down.children.map((c) => [c.name, c.via.kind])).toEqual([['Report', 'query'], [null, 'extract']])
  })
})

// ── The engine against a fake SFMC ─────────────────────────
function stub(handler) {
  const calls = []
  vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
    calls.push(`${msg.method} ${msg.url}`)
    Promise.resolve(handler(msg.url, msg.body)).then((data) => cb(data instanceof Error ? { error: data.message } : { data }))
  } } })
  return calls
}
async function load() {
  vi.resetModules()
  return import('../usage/index.js')
}

const QUERIES = [
  { queryDefinitionId: 'Q1', name: 'Build orders', targetKey: 'ORD', targetName: 'Orders', targetUpdateTypeName: 'Overwrite', queryText: 'SELECT * FROM Raw' },
  { queryDefinitionId: 'Q2', name: 'Use orders', targetKey: 'X', targetName: 'Report', queryText: 'SELECT o.Amount FROM Orders o' },
  { queryDefinitionId: 'Q3', name: 'Other', targetKey: 'Y', queryText: 'SELECT * FROM Else' },
  { queryDefinitionId: 'Q4', name: 'No text in list', targetKey: 'Z', targetName: 'Z' },
]
const JOURNEY = { id: 'J1', name: 'Welcome', status: 'Published', version: 2, triggers: [{ metaData: { eventDefinitionKey: 'DEAudience-1' } }],
  activities: [{ name: 'Send welcome', type: 'EMAILV2', configurationArguments: { triggeredSend: { emailId: 555, senderProfileId: 'SP1' } } },
    { name: 'Split', type: 'MULTICRITERIADECISION', outcomes: [{ arguments: { criteria: 'Contact.Attribute.Orders.Amount > 5' } }] }] }
function sfmc(url, body) {
  if (url.includes('/automation/v1/queries/?')) return { count: 4, items: QUERIES.map((q) => ({ ...q })) }
  if (url.includes('/automation/v1/queries/Q4')) return { queryText: 'SELECT * FROM [Orders]' }
  if (url.includes('/automation/v1/imports/?')) return { count: 1, items: [{ importDefinitionId: 'I1', name: 'Load orders', destinationObjectId: 'DE-1', updateTypeId: 3, fileNamingPattern: 'orders.csv', fileTransferLocationId: 'L1' }] }
  if (url.includes('/automation/v1/filters/?')) return { count: 0, items: [] }
  if (url.includes('/automation/v1/dataextracts/?')) return { count: 1, items: [{ dataExtractDefinitionId: 'X1', name: 'Export', dataFields: [{ name: 'DECustomerKey', value: 'ORD' }] }] }
  if (url.includes('/automation/v1/scripts/?')) return { count: 1, items: [{ ssjsActivityId: 'S1', name: 'Clean', script: 'var d = DataExtension.Init("ORD");' }] }
  if (url.includes('/automation/v1/filetransfers/?')) return { count: 1, items: [{ id: 'F1', name: 'Get file', fileTransferLocationId: 'L1' }] }
  if (url.includes('/automation/definition/')) return { totalResults: 2, entry: [{ id: 'A1', name: 'Nightly', status: 'Scheduled' }, { id: 'A2', name: 'Broken' }] }
  if (url.endsWith('/automations/A1')) return { id: 'A1', steps: [{ step: 1, activities: [{ objectTypeId: 300, activityObjectId: 'Q1' }, { objectTypeId: 43, activityObjectId: 'I1' }] }, { step: 2, activities: [{ objectTypeId: 300, activityObjectId: 'Q2' }, { objectTypeId: 42, activityObjectId: 'E1' }] }] }
  if (url.endsWith('/automations/A2')) return new Error('SFMC API error 500')
  if (url.includes('emailsenddefinition/E1')) return { name: 'Monthly send', email: { emailId: 555 }, senderProfile: { id: 'SP2', name: 'Marketing' }, sendDefinitionList: [{ customObjectId: 'DE-1' }] }
  if (url.includes('/eventDefinitions')) return { count: 1, items: [{ id: 'EV1', name: 'Orders entry', eventDefinitionKey: 'DEAudience-1', dataExtensionId: 'DE-1', dataExtensionName: 'Orders', publishedInteractionCount: 1 }] }
  if (url.includes('/interactions?')) return { count: 1, items: [{ id: 'J1', name: 'Welcome', version: 2 }] }
  if (url.includes('/interactions/J1')) return JOURNEY
  if (url.includes('/assets/query')) return { count: 2, items: [
    { id: 10, name: 'Receipt', assetType: { id: 208, name: 'htmlemail' }, views: { html: { content: '%%[ SET @r = LookupRows("Orders", "Amount", 1) ]%% %%=ContentBlockByKey("ftr")=%%' } } },
    { id: 11, name: 'Footer', customerKey: 'ftr', assetType: { id: 197, name: 'htmlblock' }, content: '<p>footer</p>' },
  ] }
  return {}
}

describe('findUsage', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const de = { id: 'DE-1', name: 'Orders', customerKey: 'ORD' }
  const titles = (r, id) => r.sections.find((s) => s.id === id).items.map((i) => i.title)

  it('finds everything that uses a DE and reports every stage', async () => {
    stub(sfmc)
    const { findUsage } = await load()
    const seen = {}
    const r = await findUsage('s7', { kind: 'de', de }, { onStage: (id, s) => { seen[id] = s.state } })
    expect(titles(r, 'queries')).toEqual(['Build orders', 'No text in list', 'Use orders'])
    expect(r.sections.find((s) => s.id === 'queries').items[0].automations).toMatchObject([{ name: 'Nightly', step: 1 }])
    expect(titles(r, 'imports')).toEqual(['Load orders'])
    expect(titles(r, 'extracts')).toEqual(['Export'])
    expect(titles(r, 'scripts')).toEqual(['Clean'])
    expect(titles(r, 'sends')).toEqual(['Monthly send'])
    expect(titles(r, 'events')).toEqual(['Orders entry'])
    expect(titles(r, 'journeys')).toEqual(['Welcome'])
    expect(r.sections.find((s) => s.id === 'journeys').items[0].lines[0]).toBe('Entry source; In split, goal or exit criteria')
    expect(titles(r, 'content')).toEqual(['Receipt'])
    const lineage = r.sections.find((s) => s.id === 'lineage').tree
    expect(lineage.up.children.map((c) => c.name)).toEqual(['Raw', null])
    expect(lineage.down.children.map((c) => c.name)).toEqual(['Report', 'Z', null])
    expect(seen).toMatchObject({ queries: 'done', imports: 'done', automations: 'done', emailsends: 'done', journeys: 'done', assets: 'done', analyse: 'done' })
  })

  it('reuses the cache and skips automations when nothing needs them', async () => {
    const calls = stub(sfmc)
    const { findUsage } = await load()
    await findUsage('s7', { kind: 'de', de })
    const before = calls.length
    const seen = {}
    const r = await findUsage('s7', { kind: 'de', de: { name: '_Sent', dataView: true } }, { onStage: (id, s) => { seen[id] = s.state } })
    expect(calls.length).toBe(before)
    expect(r.sections.find((s) => s.id === 'queries').items).toEqual([])
    expect(seen).toEqual({ queries: 'cached', analyse: 'done', automations: 'skipped' })
  })

  it('finds where a field is used', async () => {
    stub(sfmc)
    const { findUsage } = await load()
    const r = await findUsage('s7', { kind: 'field', de, field: 'Amount' })
    expect(titles(r, 'queries')).toEqual(['Use orders', 'No text in list'])
    expect(titles(r, 'journeys')).toEqual(['Welcome'])
    expect(titles(r, 'content')).toEqual(['Receipt'])
  })

  it('finds the automations an activity runs in', async () => {
    stub(sfmc)
    const { findUsage } = await load()
    const r = await findUsage('s7', { kind: 'activity', typeId: 300, activityObjectId: 'Q2', name: 'Use orders', details: QUERIES[1] })
    expect(r.sections[0].items.map((i) => [i.title, i.lines[0]])).toEqual([['Nightly', 'Step 2']])
    expect(titles(r, 'tables')).toEqual(['Report', 'Orders'])
  })

  it('lists what an automation touches', async () => {
    stub((url, body) => {
      if (url.includes('/automations/A1')) return sfmc(url, body)
      if (url.includes('/queries/Q1')) return QUERIES[0]
      if (url.includes('/queries/Q2')) return QUERIES[1]
      if (url.includes('/imports/I1')) return { name: 'Load orders', destinationName: 'Orders', fileNamingPattern: 'orders.csv' }
      if (url.includes('emailsenddefinition/E1')) return { name: 'Monthly send', emailSubject: 'Hello' }
      return {}
    })
    const { findUsage } = await load()
    const r = await findUsage('s7', { kind: 'automation', id: 'A1', name: 'Nightly' })
    expect(titles(r, 'writes')).toEqual(['Orders', 'Report'])
    expect(titles(r, 'reads')).toEqual(['Orders', 'Raw'])
    expect(r.sections.find((s) => s.id === 'files').items[0].title).toMatch(/orders\.csv/)
    expect(titles(r, 'emails')).toEqual(['Monthly send'])
  })

  it('finds journeys for an entry event, an email, a content block, a file location and profiles', async () => {
    stub(sfmc)
    const { findUsage } = await load()
    expect(titles(await findUsage('s7', { kind: 'event', event: { id: 'EV1', eventDefinitionKey: 'DEAudience-1', dataExtensionName: 'Orders' } }), 'journeys')).toEqual(['Welcome'])
    const email = await findUsage('s7', { kind: 'email', asset: { id: 10, name: 'Receipt', data: { email: { legacy: { legacyId: 555 } } } } })
    expect(titles(email, 'journeys')).toEqual(['Welcome'])
    expect(titles(email, 'sends')).toEqual(['Monthly send'])
    const block = await findUsage('s7', { kind: 'block', asset: { id: 11, name: 'Footer', customerKey: 'ftr' } })
    expect(titles(block, 'email')).toEqual(['Receipt'])
    const loc = await findUsage('s7', { kind: 'location', location: { id: 'L1', name: 'ExactTarget Enhanced FTP' } })
    expect(titles(loc, 'imports')).toEqual(['Load orders'])
    expect(titles(loc, 'transfers')).toEqual(['Get file'])
    const prof = await findUsage('s7', { kind: 'profiles', profileType: 'sender' })
    expect(prof.sections.map((s) => [s.title, s.items.map((i) => i.title)])).toEqual([['Marketing (SP2)', ['Monthly send']], ['SP1', ['Welcome']]])
  })

  it('keeps going when a source fails, and stops when asked', async () => {
    stub((url, body) => (url.includes('/interactions') ? new Error('SFMC API error 401') : sfmc(url, body)))
    const { findUsage } = await load()
    const seen = {}
    const r = await findUsage('s7', { kind: 'event', event: { id: 'EV1', eventDefinitionKey: 'DEAudience-1' } }, { onStage: (id, s) => { seen[id] = s } })
    expect(seen.journeys).toMatchObject({ state: 'error', note: 'SFMC API error 401' })
    expect(r.sections.find((s) => s.id === 'journeys').unavailable).toBe(true)
    await expect(findUsage('s8', { kind: 'de', de }, { shouldStop: () => true })).rejects.toMatchObject({ stopped: true })
  })

  it('leaves out a skipped source and never saves a skipped load (feedback #70)', async () => {
    let skipAssets = false
    const calls = stub((url, body) => {
      if (url.includes('/assets/query')) {
        const page = sfmc(url, body)
        skipAssets = true // Skip clicked while the first page loads
        return { ...page, count: 5000 }
      }
      return sfmc(url, body)
    })
    const { findUsage } = await load()
    const seen = {}
    const r = await findUsage('s9', { kind: 'de', de }, { onStage: (id, s) => { seen[id] = s }, isSkipped: (id) => id === 'assets' && skipAssets })
    expect(seen.assets).toMatchObject({ state: 'skipped' })
    expect(seen.journeys.state).toBe('done')
    expect(r.sections.find((s) => s.id === 'content').unavailable).toBe(true)
    expect(titles(r, 'queries')).toEqual(['Build orders', 'No text in list', 'Use orders'])
    const assetCalls = calls.filter((c) => c.includes('/assets/query')).length

    // Ticked before the check: not loaded at all.
    const again = {}
    await findUsage('s9', { kind: 'de', de }, { onStage: (id, s) => { again[id] = s }, isSkipped: (id) => id === 'assets' })
    expect(again.assets.state).toBe('skipped')
    expect(calls.filter((c) => c.includes('/assets/query')).length).toBe(assetCalls)

    // Nothing partial was saved: included again, it loads in full.
    skipAssets = false
    const third = {}
    stub(sfmc)
    await findUsage('s9', { kind: 'de', de }, { onStage: (id, s) => { third[id] = s } })
    expect(third.assets.state).toBe('done')
  })

  it('uses saved data for a skipped source', async () => {
    stub(sfmc)
    const { findUsage } = await load()
    await findUsage('s10', { kind: 'de', de })
    const seen = {}
    const r = await findUsage('s10', { kind: 'de', de }, { onStage: (id, s) => { seen[id] = s }, isSkipped: (id) => id === 'assets' })
    expect(seen.assets).toMatchObject({ state: 'cached' })
    expect(seen.assets.note).toMatch(/^skipped, using data saved/)
    expect(titles(r, 'content')).toEqual(['Receipt'])
  })
})

describe('deltaList', () => {
  it('reads only until it reaches saved changes and merges by ID', async () => {
    const { deltaList } = await import('../usage/sources.js')
    const saved = { items: [{ id: 'B', m: '2026-10-02' }, { id: 'A', m: '2026-10-01' }], total: 2 }
    const server = [{ id: 'C', m: '2026-10-05' }, { id: 'A', m: '2026-10-04' }, { id: 'B', m: '2026-10-02' }]
    const pages = []
    const r = await deltaList({
      saved, idOf: (i) => i.id, modOf: (i) => i.m, progress: () => {}, stop: () => false,
      fetchPage: async (p) => { pages.push(p); return { items: server.slice(p * 2, p * 2 + 2), total: 3 } },
    })
    expect(pages).toEqual([0, 1])
    expect(r.items.map((i) => i.id)).toEqual(['C', 'A', 'B'])
    expect(r).toMatchObject({ changed: 2, complete: true, total: 3 })
  })
  it('says incomplete when something was deleted', async () => {
    const { deltaList } = await import('../usage/sources.js')
    const saved = { items: [{ id: 'B', m: '2026-10-02' }, { id: 'A', m: '2026-10-01' }], total: 2 }
    const r = await deltaList({ saved, idOf: (i) => i.id, modOf: (i) => i.m, progress: () => {}, stop: () => false, fetchPage: async () => ({ items: [{ id: 'B', m: '2026-10-02' }], total: 1 }) })
    expect(r.complete).toBe(false)
  })
})

describe('saved data (feedback #26)', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const de = { id: 'DE-1', name: 'Orders', customerKey: 'ORD' }
  const later = () => Date.now() + 10 * 60 * 1000

  it('reuses data for 5 minutes, then reads only what changed', async () => {
    const calls = stub(sfmc)
    const { findUsage } = await load()
    await findUsage('s7', { kind: 'activity', typeId: 300, activityObjectId: 'Q1' })
    const first = calls.filter((c) => c.includes('/automations/A')).length
    expect(first).toBe(2)
    // Within 5 minutes: no SFMC call at all (not even the business unit, cached for a minute).
    const before = calls.length
    const seen = {}
    await findUsage('s7', { kind: 'activity', typeId: 300, activityObjectId: 'Q2' }, { onStage: (id, s) => { seen[id] = s } })
    expect(calls.length).toBe(before)
    expect(seen.automations).toMatchObject({ state: 'cached' })
    // Later: the list is read again, steps only for the automation without a change marker match.
    const seen2 = {}
    await findUsage('s7', { kind: 'activity', typeId: 300, activityObjectId: 'Q2' }, { now: later, onStage: (id, s) => { seen2[id] = s } })
    expect(seen2.automations.state).toBe('done')
    expect(seen2.automations.note).toMatch(/changed since the last scan/)
  })

  it('keeps business units apart', async () => {
    let mid = 1
    const calls = stub((url, body) => (url.includes('accounts/@current') ? { name: `BU ${mid}`, accountId: mid } : sfmc(url, body)))
    const { findUsage } = await load()
    await findUsage('s7', { kind: 'de', de })
    const n = calls.filter((c) => c.includes('/automation/v1/queries/?')).length
    mid = 2
    // Another BU (looked up again once the 1-minute BU cache runs out): read in full,
    // not refreshed from BU 1's data.
    const seen = {}
    await findUsage('s7', { kind: 'de', de }, { now: later, onStage: (id, s) => { seen[id] = s } })
    expect(seen.queries).toMatchObject({ state: 'done', note: '' })
    expect(calls.filter((c) => c.includes('/automation/v1/queries/?')).length).toBe(2 * n)
    // Back to BU 1 later still: its own saved data is refreshed.
    mid = 1
    const seen1 = {}
    await findUsage('s7', { kind: 'de', de }, { now: () => Date.now() + 20 * 60 * 1000, onStage: (id, s) => { seen1[id] = s } })
    expect(seen1.queries.note).toBe('no changes since the last scan')
  })

  it('refreshes activity lists by reading only the newest page', async () => {
    let queries = QUERIES.map((q, i) => ({ ...q, modifiedDate: `2026-10-0${4 - Math.min(i, 3)}T00:00:00` }))
    const calls = stub((url, body) => (url.includes('/automation/v1/queries/?') ? { count: queries.length, items: queries.map((q) => ({ ...q })) } : sfmc(url, body)))
    const { findUsage } = await load()
    await findUsage('s7', { kind: 'field', de: { name: '_Sent', dataView: true }, field: 'JobID' })
    queries = [{ queryDefinitionId: 'Q9', name: 'New one', targetKey: 'N', queryText: 'SELECT JobID FROM _Sent', modifiedDate: '2026-10-09T00:00:00' }, ...queries]
    const seen = {}
    const r = await findUsage('s7', { kind: 'field', de: { name: '_Sent', dataView: true }, field: 'JobID' }, { now: later, onStage: (id, s) => { seen[id] = s } })
    expect(seen.queries.note).toBe('1 changed since the last scan')
    expect(r.sections[0].items.map((i) => i.title)).toEqual(['New one'])
    expect(calls.filter((c) => c.includes('/automation/v1/queries/?')).length).toBe(2)
  })
})

describe('DE named in content outside Lookup calls (feedback #55)', () => {
  it('finds the name as a whole word, not inside longer names', async () => {
    const { mentionsName } = await import('../usage/match.js')
    const de = { name: 'ENS_WhatsApp_Log', customerKey: 'ENS_WhatsApp_Log' }
    expect(mentionsName('var prox = new Script.Util.WSProxy(); prox.retrieve("DataExtensionObject[ENS_WhatsApp_Log]")', de)).toBe(true)
    expect(mentionsName('<p>Rows go to ENS_WhatsApp_Log.</p>', de)).toBe(true)
    expect(mentionsName('var de = "ens_whatsapp_log";', de)).toBe(true)
    expect(mentionsName('ENS_WhatsApp_Log_Archive', de)).toBe(false)
    expect(mentionsName('anything', { name: 'Log' })).toBe(false)
  })
})
