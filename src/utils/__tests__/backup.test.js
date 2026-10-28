import { describe, it, expect } from 'vitest'
import { buildBackup, parseBackup, planImport, describeImport, BACKUP_FORMAT } from '../backup.js'

const query = (id, extra = {}) => ({ id, name: id, queryText: 'SELECT 1', timeStamp: 1, ...extra })
const email = (id, versionIds) => ({ id, assetId: 7, versions: versionIds.map((v) => ({ versionId: v, savedAt: Number(v.slice(2)) })) })

describe('buildBackup', () => {
  it('keeps records and listed settings, drops session state', () => {
    const b = buildBackup({
      sql_1: query('sql_1', { runs: [{ runId: 'r' }] }),
      email_7: email('email_7', ['v_1']),
      workspace_1: { id: 'workspace_1', panels: [{ queryId: 'sql_1' }] },
      _reuseQueryDE: true,
      lintDisabledRules: ['QS012'],
      _csrfTokens: { s10: {} },
      sfmcStack: 's10',
      stackOverride: 's10',
      sfmcqs_analytics_cid: 'x',
      _seenVersion: '1.4.0',
      sql_bad: 'not a record',
    }, { app: 'sfmc-query-saver', appVersion: '1.4.1', now: new Date('2026-10-14T10:00:00Z') })
    expect(b.format).toBe(BACKUP_FORMAT)
    expect(b.exportedAt).toBe('2026-10-14T10:00:00.000Z')
    expect(Object.keys(b.items).sort()).toEqual(['_reuseQueryDE', 'email_7', 'lintDisabledRules', 'sql_1', 'workspace_1'])
    expect(b.items.sql_1.runs).toHaveLength(1)
  })
})

describe('parseBackup', () => {
  it('rejects other files with a clear message', () => {
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/)
    expect(() => parseBackup('{"a":1}')).toThrow(/not an SFMC Query Saver or Marketing Cloud Toolkit backup/)
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, items: {} }))).toThrow(/newer version/)
  })
  it('accepts a backup', () => {
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, items: { a: 1 } })).items).toEqual({ a: 1 })
  })
})

describe('planImport', () => {
  it('adds new records and never overwrites existing ones', () => {
    const plan = planImport(
      { sql_1: query('sql_1', { name: 'imported' }), sql_2: query('sql_2') },
      { sql_1: query('sql_1', { name: 'mine' }) })
    expect(Object.keys(plan.writes)).toEqual(['sql_2'])
    expect(plan.added.queries).toBe(1)
    expect(plan.skipped.queries).toBe(1)
  })

  it('adds the email versions that are missing', () => {
    const plan = planImport({ email_7: email('email_7', ['v_3', 'v_1']) }, { email_7: email('email_7', ['v_2', 'v_1']) })
    expect(plan.writes.email_7.versions.map((v) => v.versionId)).toEqual(['v_3', 'v_2', 'v_1'])
    expect(plan.merged.emails).toBe(1)
  })

  it('sets a setting only when it is not set, and combines lint rules', () => {
    const plan = planImport(
      { _reuseQueryDE: true, cardSize: 'large', lintDisabledRules: ['QS012', 'QS020'], _seenVersion: 'x' },
      { cardSize: 'compact', lintDisabledRules: ['QS001', 'QS012'] })
    expect(plan.writes).toEqual({ _reuseQueryDE: true, lintDisabledRules: ['QS001', 'QS012', 'QS020'] })
  })

  it('describes the result', () => {
    const plan = planImport({ sql_1: query('sql_1'), sql_2: query('sql_2'), email_7: email('email_7', ['v_1']) }, { sql_2: query('sql_2') })
    expect(describeImport(plan)).toBe('Imported 1 query, 1 email. 1 already here, kept as they are.')
    expect(describeImport(planImport({}, {}))).toBe('Nothing new to import.')
  })
})
