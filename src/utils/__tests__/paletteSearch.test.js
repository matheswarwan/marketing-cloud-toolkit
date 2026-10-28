import { describe, it, expect } from 'vitest'
import { paletteEntries } from '../paletteSearch.js'

const sections = [{ path: '/automations', name: 'Automations', group: 'Automation' }, { path: '/emails', name: 'Emails', group: 'Content' }]
const storage = {
  sql_1: { id: 'sql_1', name: 'Active subscribers', queryText: 'SELECT 1', timeStamp: 2 },
  sql_2: { id: 'sql_2', name: 'Join', queryText: 'SELECT a FROM [Orders]', timeStamp: 3, source: 'builder' },
  sql_3: { id: 'sql_3', name: 'Panel 1', queryText: '', timeStamp: 4 },
  email_7: { id: 'email_7', assetId: 7, name: 'Spring sale', subject: 'Orders ship free' },
  _seenVersion: '2.0.0',
}

describe('paletteEntries', () => {
  it('lists only sections when nothing is typed', () => {
    expect(paletteEntries('', sections, storage).map((e) => e.kind)).toEqual(['section', 'section'])
  })

  it('finds saved queries, emails and offers SFMC searches', () => {
    const r = paletteEntries('orders', sections, storage)
    expect(r.filter((e) => e.kind === 'query')).toEqual([{ kind: 'query', label: 'Join', hint: 'Query Builder', to: { path: '/queries/builder', query: { id: 'sql_2' } } }])
    expect(r.find((e) => e.kind === 'email').to).toEqual({ path: '/emails/email_7' })
    expect(r.filter((e) => e.kind === 'search').map((e) => e.to.path)).toEqual(['/data-extensions', '/automations', '/activities', '/journeys', '/journey-entry', '/cloudpages'])
    expect(r.find((e) => e.kind === 'search').to.query).toEqual({ q: 'orders' })
  })

  it('matches sections by name and skips never-typed panels', () => {
    const r = paletteEntries('auto', sections, storage)
    expect(r[0]).toMatchObject({ kind: 'section', label: 'Automations' })
    expect(paletteEntries('panel', sections, storage).some((e) => e.kind === 'query')).toBe(false)
  })
})
