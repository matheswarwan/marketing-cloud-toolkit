import { describe, it, expect, beforeEach } from 'vitest'
import {
  recoverableDays, recoverableText, toDeletedDE, fetchDeletedDEs, fetchRecycleBinFolderId, clearRecycleBinCache,
  contentTypeGroup, fetchDeletedContent, filterContent, groupCounts, deletedContentBody, contactBuilderRecycleUrl, contentBuilderUrl,
} from '../recycleBin.js'
import { textOf, buildModel, mapRelationships, cardinalityText, linksOfSet, fetchAttributeGroups, fetchAttributeSets, groupSvg, layoutGroup } from '../dataModel.js'

const DAY = 86400000
const NOW = Date.parse('2026-11-10T12:00:00Z')

describe('Recycle bin: data extensions (2026-11-10)', () => {
  beforeEach(() => clearRecycleBinCache())

  it('counts 30 days from deletion and never goes below 0', () => {
    expect(recoverableDays(new Date(NOW - 6 * DAY).toISOString(), NOW)).toBe(24)
    expect(recoverableDays(new Date(NOW - 6.2 * DAY).toISOString(), NOW)).toBe(24)
    expect(recoverableDays(new Date(NOW).toISOString(), NOW)).toBe(30)
    expect(recoverableDays(new Date(NOW - 45 * DAY).toISOString(), NOW)).toBe(0)
    expect(recoverableDays('', NOW)).toBeNull()
    expect(recoverableDays('not a date', NOW)).toBeNull()
    expect(recoverableText(24)).toBe('24 days')
    expect(recoverableText(1)).toBe('1 day')
    expect(recoverableText(0)).toMatch(/expired/)
    expect(recoverableText(null)).toBe('')
  })

  it('maps a deleted DE as Contact Builder shows it', () => {
    const de = toDeletedDE({ id: 'a1', name: 'Old', key: 'K', rowCount: 5, fieldCount: 3, isSendable: true, modifiedDate: new Date(NOW - 2 * DAY).toISOString(), modifiedByName: 'Mathes', createdByName: 'X', categoryFullPathForRecyclebin: 'Data Extensions\\QueryStudioResults', categoryIDForRestoringDE: 77 }, NOW)
    expect(de).toMatchObject({ id: 'a1', name: 'Old', key: 'K', originalPath: 'Data Extensions > QueryStudioResults', deletedBy: 'Mathes', createdBy: 'X', rowCount: 5, fieldCount: 3, sendable: true, recoverableDays: 28, restoreFolderId: 77 })
  })

  it('finds the Recycle Bin folder once and pages through its DEs', async () => {
    const calls = []
    const fetch = async (url) => {
      calls.push(url)
      if (url.includes('/legacy/v1/beta/folder')) return { entry: [{ id: '354106', type: 'recyclebin', name: 'Recycle Bin' }] }
      const page = Number(/\$page=(\d+)/.exec(url)[1])
      const n = page === 1 ? 50 : 5
      return { count: 55, items: Array.from({ length: n }, (_, i) => ({ id: `${page}-${i}`, name: `DE ${i}`, modifiedDate: new Date(NOW).toISOString() })) }
    }
    const r = await fetchDeletedDEs('s10', { fetch, now: NOW })
    expect(r.count).toBe(55)
    expect(r.items).toHaveLength(55)
    expect(calls[0]).toContain("https://mc.s10.marketingcloudapps.com/contactsmeta/fuelapi/legacy/v1/beta/folder?$where=allowedtypes%20in%20('recyclebin')")
    expect(calls[1]).toContain('/data-internal/v1/customobjects/category/354106?retrievalType=1&$page=1&$pagesize=50&$orderBy=modifiedDate%20DESC')
    expect(calls).toHaveLength(3)
    await fetchRecycleBinFolderId('s10', fetch)
    expect(calls).toHaveLength(3) // cached
  })

  it('says so when SFMC has no Recycle Bin folder', async () => {
    await expect(fetchRecycleBinFolderId('s10', async () => ({ entry: [] }))).rejects.toThrow(/Recycle Bin folder/)
  })

  it('links to SFMC for restoring', () => {
    expect(contactBuilderRecycleUrl('s10')).toBe('https://mc.s10.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extensions')
    expect(contentBuilderUrl('s10')).toBe('https://mc.s10.exacttarget.com/cloud/#app/Content%20Builder')
  })
})

describe('Recycle bin: Content Builder (2026-11-10)', () => {
  it('groups asset types', () => {
    expect(contentTypeGroup({ id: 208, name: 'htmlemail' })).toBe('emails')
    expect(contentTypeGroup({ id: 207, name: 'templatebasedemail' })).toBe('emails')
    expect(contentTypeGroup({ id: 209, name: 'textonlyemail' })).toBe('emails')
    expect(contentTypeGroup({ id: 197, name: 'htmlblock' })).toBe('blocks')
    expect(contentTypeGroup({ id: 220, name: 'codesnippetblock' })).toBe('blocks')
    expect(contentTypeGroup({ id: 28, name: 'png' })).toBe('files')
    expect(contentTypeGroup({ id: 127, name: 'pdf' })).toBe('files')
    expect(contentTypeGroup({ id: 205, name: 'webpage' })).toBe('other')
    expect(contentTypeGroup({})).toBe('other')
  })

  it('asks for deleted items (status 6), ours only unless shared ones are wanted', async () => {
    const calls = []
    const fetch = async (url, method, body) => {
      calls.push({ url, method, body })
      return { count: 2, items: [
        { id: 1, name: 'Welcome', customerKey: 'w', assetType: { id: 208, name: 'htmlemail', displayName: 'HTML Email' }, category: { id: 9, name: 'Content Builder' }, createdBy: { name: 'A' }, modifiedBy: { name: 'B' }, modifiedDate: '2026-11-01T00:00:00' },
        { id: 2, name: 'Logo', assetType: { id: 28, name: 'png', displayName: 'PNG' }, category: { id: 9, name: 'Images' } },
      ] }
    }
    const r = await fetchDeletedContent('s10', { fetch })
    expect(calls[0].url).toBe('https://content-builder.s10.marketingcloudapps.com/fuelapi/asset/v1/content/assets/query?scope=ours')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body.query).toEqual({ property: 'status.id', simpleOperator: 'equals', value: 6 })
    expect(r.items[0]).toMatchObject({ id: '1', name: 'Welcome', key: 'w', type: 'HTML Email', group: 'emails', folder: 'Content Builder', createdBy: 'A', modifiedBy: 'B' })
    expect(groupCounts(r.items)).toMatchObject({ all: 2, emails: 1, files: 1, blocks: 0 })
    expect(filterContent(r.items, { group: 'files' }).map((i) => i.name)).toEqual(['Logo'])
    expect(filterContent(r.items, { text: 'welc' }).map((i) => i.name)).toEqual(['Welcome'])
    await fetchDeletedContent('s10', { fetch, includeShared: true })
    expect(calls[1].url).not.toContain('scope=')
    expect(deletedContentBody(2).page).toEqual({ page: 2, pageSize: 50 })
  })
})

// Shapes as seen on s10 (relationships), plus guessed link-field names.
const rawSets = [
  { id: 'S1', key: 'loyalty', name: { value: 'Loyalty' }, storageLogicalType: 'DataExtension', isRoot: true, isSendable: true,
    attributes: [{ id: 'A1', name: { value: 'MemberKey' } }],
    relationships: [{ id: 'R1', leftItem: { relationshipType: 'AttributeGroup', identifier: 'G1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'One' }, relationshipAttributes: [{ leftAttributeName: 'Contact Key', rightAttributeID: 'A1' }] },
      { id: 'R2', leftItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S2', cardinality: 'Many' } }] },
  { id: 'S2', name: 'Purchases', storageLogicalType: 'DataExtension',
    relationships: [{ id: 'R2', leftItem: { relationshipType: 'AttributeSet', identifier: 'S1', cardinality: 'One' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S2', cardinality: 'Many' } }] },
  { id: 'S3', name: { value: 'Loose' }, relationships: [] },
]

describe('Data model (2026-11-10)', () => {
  it('reads names given as text or { value }', () => {
    expect(textOf({ value: 'X' })).toBe('X')
    expect(textOf('Y')).toBe('Y')
    expect(textOf(null)).toBe('')
  })

  it('maps relationships once each, with link fields and cardinality', () => {
    const rels = mapRelationships(rawSets)
    expect(rels.map((r) => r.id)).toEqual(['R1', 'R2'])
    expect(rels[0].left).toEqual({ kind: 'group', id: 'G1', cardinality: 'One' })
    expect(rels[0].fields).toEqual([{ left: 'Contact Key', right: 'MemberKey', leftId: '', rightId: 'a1' }])
    expect(cardinalityText('One', 'Many')).toBe('one-to-many')
    expect(cardinalityText('Many', 'One')).toBe('many-to-one')
    expect(cardinalityText('', '')).toBe('')
  })

  it('dedupes a link SFMC lists on both sets by relationshipID', () => {
    const rel = { relationshipID: 'X', leftItem: { relationshipType: 'AttributeSet', identifier: 'A' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'B' } }
    const rels = mapRelationships([{ id: 'A', relationships: [rel] }, { id: 'B', relationships: [rel] }])
    expect(rels.map((r) => r.id)).toEqual(['X'])
  })

  it('puts the sets each group reaches under it, and the rest apart', () => {
    const m = buildModel(rawSets, [{ id: 'g1', name: 'Loyalty members', key: '' }])
    expect(m.groups).toHaveLength(1)
    expect(m.groups[0].name).toBe('Loyalty members')
    expect(m.groups[0].sets.map((s) => s.name)).toEqual(['Loyalty', 'Purchases'])
    expect(m.unplaced.map((s) => s.name)).toEqual(['Loose'])
    const loyalty = m.groups[0].sets[0]
    expect(loyalty).toMatchObject({ root: true, sendable: true, storage: 'DataExtension' })
    expect(linksOfSet(loyalty, m.groups[0].links)).toEqual(['Linked to Loyalty members on MemberKey = Contact Key, one-to-one', 'Linked to Purchases, one-to-many'])
    expect(linksOfSet(m.groups[0].sets[1], m.groups[0].links)).toEqual(['Linked to Loyalty, many-to-one'])
  })

  it('names groups it only knows from the links', () => {
    const m = buildModel(rawSets, [])
    expect(m.groups[0].name).toBe('Attribute group G1')
  })

  it('tries the group sources in turn and pages through the sets', async () => {
    const calls = []
    const groups = await fetchAttributeGroups('s10', async (url) => { calls.push(url); if (url.includes('jbinteractions')) throw new Error('404'); return { items: [{ id: 'G1', name: { value: 'Main' } }] } })
    expect(groups.groups).toEqual([{ id: 'G1', key: '', name: 'Main', description: '' }])
    expect(groups.source).toContain('contacts-internal')
    expect((await fetchAttributeGroups('s10', async () => { throw new Error('no') })).groups).toEqual([])
    const pages = []
    const sets = await fetchAttributeSets('s10', async (url) => { pages.push(url); const p = Number(/\$page=(\d+)/.exec(url)[1]); return { count: 60, items: Array.from({ length: p === 1 ? 50 : 10 }, (_, i) => ({ id: `${p}${i}` })) } })
    expect(sets).toHaveLength(60)
    expect(pages[0]).toBe('https://jbinteractions.s10.marketingcloudapps.com/fuelapi/contacts/v1/attributeSetDefinitions?$page=1&$pagesize=50')
  })

  it('draws a group with escaped names', () => {
    const m = buildModel([...rawSets, { id: 'S4', name: '<b>x</b>', relationships: [{ id: 'R4', leftItem: { relationshipType: 'AttributeSet', identifier: 'S2' }, rightItem: { relationshipType: 'AttributeSet', identifier: 'S4' } }] }], [{ id: 'G1', name: 'Main' }])
    const l = layoutGroup(m.groups[0])
    expect(l.nodes).toHaveLength(4)
    expect(l.edges).toHaveLength(3)
    const svg = groupSvg(m.groups[0])
    expect(svg).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(svg).not.toContain('<b>')
    expect(svg).toContain('one-to-many')
  })
})
