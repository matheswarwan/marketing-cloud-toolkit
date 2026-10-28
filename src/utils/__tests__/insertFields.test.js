import { describe, it, expect } from 'vitest'
import { planInsertAllFields, fieldRef } from '../insertFields.js'

const F = [{ name: 'SubscriberKey' }, { name: 'Email Address' }, { name: 'Status' }]
const apply = (sql, p) => sql.slice(0, p.from) + p.insert + sql.slice(p.to)

describe('planInsertAllFields', () => {
  it('keeps ENT. for a Shared DE in an empty editor (feedback #73)', () => {
    const p = planInsertAllFields('', 0, 'ENT.My DE', F)
    expect(p.insert).toContain('FROM ENT.[My DE]')
  })

  it('writes a full query into an empty editor', () => {
    const p = planInsertAllFields('', 0, '_Subscribers', F)
    expect(p.mode).toBe('new')
    expect(p.insert).toBe('SELECT\n    SubscriberKey,\n    [Email Address],\n    Status\nFROM _Subscribers')
  })

  it('brackets a DE name that needs it', () => {
    expect(planInsertAllFields('  ', 0, 'My DE', F).insert.endsWith('FROM [My DE]')).toBe(true)
  })

  it('replaces SELECT * when the table is the only source', () => {
    const sql = 'SELECT * FROM [My DE] WHERE Status = 1'
    const p = planInsertAllFields(sql, 0, 'My DE', F)
    expect(p.mode).toBe('star')
    expect(apply(sql, p)).toBe('SELECT\n    SubscriberKey,\n    [Email Address],\n    Status\nFROM [My DE] WHERE Status = 1')
  })

  it('handles DISTINCT and TOP before the star', () => {
    expect(apply('SELECT DISTINCT * FROM t', planInsertAllFields('SELECT DISTINCT * FROM t', 0, 't', F))).toContain('DISTINCT\n    SubscriberKey,')
    expect(apply('SELECT TOP 10 * FROM t', planInsertAllFields('SELECT TOP 10 * FROM t', 0, 't', F))).toContain('TOP 10\n    SubscriberKey,')
    expect(apply('SELECT TOP (10) * FROM t', planInsertAllFields('SELECT TOP (10) * FROM t', 0, 't', F))).toContain('TOP (10)\n    SubscriberKey,')
  })

  it('replaces alias.* with qualified fields', () => {
    const sql = 'SELECT s.*, o.OrderId FROM _Subscribers s JOIN Orders o ON o.SubscriberKey = s.SubscriberKey'
    const out = apply(sql, planInsertAllFields(sql, 0, '_Subscribers', F))
    expect(out.startsWith('SELECT s.SubscriberKey,\n    s.[Email Address],\n    s.Status, o.OrderId')).toBe(true)
  })

  it('does not replace a plain * when the query has several tables', () => {
    const sql = 'SELECT * FROM _Subscribers s JOIN Orders o ON o.SubscriberKey = s.SubscriberKey'
    const p = planInsertAllFields(sql, 7, '_Subscribers', F)
    expect(p.mode).toBe('cursor')
    expect(p.insert.startsWith('s.SubscriberKey,')).toBe(true)
  })

  it('leaves COUNT(*) and multiplication alone', () => {
    const sql = 'SELECT COUNT(*) AS n, a * 2 AS b FROM t'
    const p = planInsertAllFields(sql, sql.length, 't', F)
    expect(p.mode).toBe('cursor')
    expect(p.from).toBe(sql.length)
  })

  it('inserts at the cursor, qualified by the alias', () => {
    const sql = 'SELECT  FROM _Sent AS x'
    const p = planInsertAllFields(sql, 7, '_Sent', F)
    expect(apply(sql, p)).toBe('SELECT x.SubscriberKey,\n    x.[Email Address],\n    x.Status FROM _Sent AS x')
  })

  it('returns null without fields', () => {
    expect(planInsertAllFields('SELECT * FROM t', 0, 't', [])).toBeNull()
  })

  it('fieldRef brackets and escapes', () => {
    expect(fieldRef('a]b', 'q')).toBe('q.[a]]b]')
  })
})
