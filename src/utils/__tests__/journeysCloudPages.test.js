import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterEventDefinitions, describeEventDefinition, eventIconUrl } from '../journeyApi.js'
import { cloudPageSearchBody, toCloudPage, urlFromSites, CLOUD_PAGE_ASSET_TYPE_IDS } from '../cloudPagesApi.js'

const now = new Date(2026, 9, 14, 12)
const events = [
  { name: 'Welcome Entry', eventDefinitionKey: 'DEAudience-123', type: 'EmailAudience', category: 'Audience', dataExtensionName: 'Welcome DE', publishedInteractionCount: 1, schedule: { endDateTime: '2026-12-31T00:00:00' } },
  { name: 'API thing', eventDefinitionKey: 'APIEvent-9', type: 'APIEvent', category: 'Event', dataExtensionName: 'Api DE', publishedInteractionCount: 0 },
  { name: 'Old schedule', eventDefinitionKey: 'X', type: 'AutomationAudience', category: 'Audience', publishedInteractionCount: 2, schedule: { endDateTime: '2025-01-01T00:00:00' } },
]

describe('event definition filters', () => {
  const names = (f) => filterEventDefinitions(events, f, now).map((e) => e.name)
  it('filters by key (not the DE ID box, unlike Automation Viewer)', () => expect(names({ key: 'apievent' })).toEqual(['API thing']))
  it('filters case-insensitively by name and DE name', () => {
    expect(names({ name: 'welcome' })).toEqual(['Welcome Entry'])
    expect(names({ deName: 'api de' })).toEqual(['API thing'])
  })
  it('filters by journey status, type, category and schedule', () => {
    expect(names({ journeyStatus: 'active' })).toEqual(['Welcome Entry', 'Old schedule'])
    expect(names({ journeyStatus: 'inactive' })).toEqual(['API thing'])
    expect(names({ type: 'APIEvent' })).toEqual(['API thing'])
    expect(names({ category: 'Audience' })).toEqual(['Welcome Entry', 'Old schedule'])
    expect(names({ scheduledFrom: true })).toEqual(['Welcome Entry'])
  })
  it('describes an event definition and its icon', () => {
    const d = describeEventDefinition({ ...events[0], iconUrl: 'images/icon.svg', interactionCount: 3 }, 's10')
    expect(d.typeLabel).toBe('Data Extension (Email Audience)')
    expect(Object.fromEntries(d.main)['Journey status']).toBe('Active (1 published journey)')
    expect(d.tables[0].title).toBe('Schedule')
    expect(eventIconUrl('s10', { iconUrl: 'images/icon.svg' })).toBe('https://jbinteractions.s10.marketingcloudapps.com/images/icon.svg')
    expect(eventIconUrl('s10', { iconUrl: 'javascript:alert(1)' })).toBe('https://jbinteractions.s10.marketingcloudapps.com/javascript:alert(1)')
  })
})

describe('CloudPages', () => {
  it('searches only CloudPage asset types, by text when given', () => {
    expect(cloudPageSearchBody('', 2).query).toEqual({ property: 'assetType.id', simpleOperator: 'in', values: CLOUD_PAGE_ASSET_TYPE_IDS })
    const q = cloudPageSearchBody('Sale').query
    expect(q.logicalOperator).toBe('AND')
    expect(q.leftOperand.leftOperand).toEqual({ property: 'name', simpleOperator: 'contains', value: 'sale', boost: 50 })
    expect(cloudPageSearchBody('x', 3).page).toEqual({ pageSize: 50, page: 3 })
  })
  it('reads the URL from the asset or the sites list', () => {
    expect(toCloudPage({ id: 1, name: 'P', status: { name: 'Published' }, meta: { cloudPages: { url: 'https://x/p' } } }).url).toBe('https://x/p')
    const sites = [{ key: 'K', url: 'https://cloud.example/k' }, { defaultPageId: 7, siteId: 55 }]
    expect(urlFromSites('s10', sites, { customerKey: 'K' })).toBe('https://cloud.example/k')
    expect(urlFromSites('s10', sites, { id: 7 })).toBe('https://cloud-pages.s10.marketingcloudapps.com/sites/55')
    expect(urlFromSites('s10', sites, { id: 8, name: 'none' })).toBeNull()
  })
})

describe('CloudPage folder path', () => {
  beforeEach(() => vi.resetModules())
  it('walks up to CloudPages and caches folders', async () => {
    const calls = []
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(m, cb) {
      calls.push(m.url)
      const id = m.url.match(/categories\/(\d+)\//)[1]
      cb({ data: { 3: { name: 'Spring', parentId: 2 }, 2: { name: 'Campaigns', parentId: 1 }, 1: { name: 'CloudPages', parentId: 0 } }[id] })
    } } })
    const { fetchCloudPageFolderPath } = await import('../cloudPagesApi.js')
    expect(await fetchCloudPageFolderPath('s10', 3)).toBe('Campaigns > Spring')
    expect(await fetchCloudPageFolderPath('s10', 1)).toBe('Root')
    expect(calls).toHaveLength(3)
    vi.unstubAllGlobals()
  })
})

describe('CloudPage URL in content (feedback #51)', () => {
  it('reads the url from the JSON string in content', async () => {
    const { urlFromAsset } = await import('../cloudPagesApi.js')
    const asset = { id: 1001, assetType: { id: 247, name: 'landingpage' }, content: '{"url":"https://example.pub.s4.sfmc-content.com/welcome-page"}', meta: { cloudPages: { publishDate: '2025-09-26' } } }
    expect(urlFromAsset(asset)).toBe('https://example.pub.s4.sfmc-content.com/welcome-page')
    expect(urlFromAsset({ content: '<html>' })).toBeNull()
    expect(urlFromAsset({ content: '{"url":"javascript:alert(1)"}' })).toBeNull()
    expect(urlFromAsset({ content: { url: 'https://x.example/p' } })).toBe('https://x.example/p')
  })
})
