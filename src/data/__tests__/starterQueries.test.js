import { describe, it, expect } from 'vitest'
import { STARTER_QUERIES, STARTER_CATEGORIES } from '../starterQueries.js'
import { lintSql } from '../../utils/sqlLint.js'
import { DATA_VIEW_FIELDS } from '../../utils/dataViews.js'

describe('starter queries', () => {
  it('have unique ids, a known category, a title and a purpose', () => {
    expect(new Set(STARTER_QUERIES.map((q) => q.id)).size).toBe(STARTER_QUERIES.length)
    for (const q of STARTER_QUERIES) {
      expect(STARTER_CATEGORIES).toContain(q.category)
      expect(q.title && q.purpose && q.sql).toBeTruthy()
    }
  })

  it.each(STARTER_QUERIES.map((q) => [q.id, q]))('%s passes the lint without errors', (_id, q) => {
    const errors = lintSql(q.sql).filter((d) => d.severity === 'error')
    expect(errors.map((e) => `${e.code} ${e.message}`)).toEqual([])
  })

  it.each(STARTER_QUERIES.map((q) => [q.id, q]))('%s names only real data view fields', (_id, q) => {
    const aliases = {}
    for (const m of q.sql.matchAll(/\b(?:FROM|JOIN)\s+(_\w+)\s+(\w+)/gi)) aliases[m[2].toLowerCase()] = m[1].toUpperCase()
    for (const m of q.sql.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const view = aliases[m[1].toLowerCase()]
      if (!view) continue
      const fields = (DATA_VIEW_FIELDS[view] || []).map((f) => (f.name || f).toLowerCase())
      expect(fields, `${view}.${m[2]}`).toContain(m[2].toLowerCase())
    }
  })
})
