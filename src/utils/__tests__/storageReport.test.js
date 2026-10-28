import { describe, it, expect } from 'vitest'
import { storageReport, trimEmailVersions, entryBytes } from '../storageReport.js'

const big = (n) => 'x'.repeat(n)
const items = {
  sql_1: { id: 'sql_1', queryText: 'SELECT 1', businessUnit: { name: 'Northwind', accountId: 1 } },
  sql_2: { id: 'sql_2', queryText: 'SELECT 2', businessUnit: { name: 'Acme', accountId: 2 } },
  sql_3: { id: 'sql_3', queryText: 'SELECT 3' },
  email_10: { assetId: 10, memberId: 100, stack: 's13', versions: [{ savedAt: 3, compileAsset: big(5000) }, { savedAt: 1, compileAsset: big(5000) }, { savedAt: 2, compileAsset: big(5000) }] },
  email_11: { assetId: 11, memberId: 200, versions: [{ savedAt: 1, compileAsset: big(100) }] },
  workspace_a: { panels: [] },
  sfmcqs_theme: 'dark',
}

describe('storage report (feedback #47)', () => {
  it('splits by section and business unit, biggest first, with the total', () => {
    const r = storageReport(items)
    expect(r.categories.map((c) => c.id)).toEqual(['emails', 'queries', 'workspaces', 'other'])
    expect(r.total).toBe(Object.entries(items).reduce((s, [k, v]) => s + entryBytes(k, v), 0))
    const emails = r.categories[0]
    expect(emails).toMatchObject({ count: 2, versions: 4 })
    expect(emails.groups.map((g) => [g.label, g.keys])).toEqual([['Business unit 100 (s13)', ['email_10']], ['Business unit 200', ['email_11']]])
    // A saved query with the same MID gives the email group its name.
    const named = storageReport({ ...items, sql_9: { id: 'sql_9', queryText: 'x', businessUnit: { name: 'Northwind', accountId: 100 } } })
    expect(named.categories.find((c) => c.id === 'emails').groups[0].label).toBe('Northwind (s13)')
    const queries = r.categories[1]
    expect(queries.groups.map((g) => g.label).sort()).toEqual(['Acme', 'No business unit recorded', 'Northwind'])
  })

  it('keeps the newest versions of each email', () => {
    const t = trimEmailVersions(items, 1)
    expect(Object.keys(t.updates)).toEqual(['email_10'])
    expect(t.updates.email_10.versions.map((v) => v.savedAt)).toEqual([3])
    expect(t.removedVersions).toBe(2)
    expect(t.savedBytes).toBeGreaterThan(10000)
    expect(trimEmailVersions(items, 5).removedVersions).toBe(0)
  })
})
