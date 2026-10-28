import { describe, it, expect } from 'vitest'
import { checkTarget } from '../targetChecks.js'

const T = (name, type, extra = {}) => ({ name, type, ...extra })

describe('Checks before Save as query activity', () => {
  it('finds missing required fields, dropped columns, types and lengths', () => {
    const r = checkTarget({
      sql: 'SELECT a.Key, a.Name, a.Age, a.Extra FROM [Src] a',
      outFields: [T('Key', 0, { length: 50 }), T('Name', 0, { length: 500 }), T('Age', 0, { length: 4000 }), T('Extra', 0)],
      targetFields: [T('Key', 'Text', { length: 50, isPrimaryKey: true }), T('Name', 'Text', { length: 100 }), T('Age', 'Number'), T('Email', 'EmailAddress', { isNullable: false })],
      updateType: 2, targetName: 'Target',
    })
    const text = r.map((c) => `${c.level}: ${c.text}`).join('\n')
    expect(text).toMatch(/warning: Extra: no field/)
    expect(text).toMatch(/error: Email is required/)
    expect(text).toMatch(/warning: Age is text in the query but Number/)
    expect(text).toMatch(/warning: Name can be 500 characters but the target field holds 100/)
  })

  it('checks the data action', () => {
    const noKey = checkTarget({ sql: 'SELECT x FROM a', outFields: [T('x', 0)], targetFields: [T('x', 'Text')], updateType: 1 })
    expect(noKey.some((c) => c.level === 'error' && /primary key/.test(c.text))).toBe(true)
    const self = checkTarget({ sql: 'SELECT x FROM [Target]', outFields: [T('x', 0)], targetFields: [T('x', 'Text')], updateType: 0, targetName: 'Target' })
    expect(self.some((c) => /empties the target first, so the query reads an empty table/.test(c.text))).toBe(true)
  })

  it('warns when a join can repeat the key', () => {
    const r = checkTarget({
      sql: 'SELECT s.SubscriberKey, o.EventDate FROM _Subscribers s JOIN _Open o ON o.SubscriberKey = s.SubscriberKey',
      outFields: [T('SubscriberKey', 0), T('EventDate', 2)],
      targetFields: [T('SubscriberKey', 'Text', { isPrimaryKey: true, length: 254 }), T('EventDate', 'Date')], updateType: 2,
    })
    expect(r.some((c) => /fails Append/.test(c.text))).toBe(true)
    const ok = checkTarget({ sql: 'SELECT DISTINCT s.SubscriberKey FROM _Subscribers s JOIN _Open o ON o.SubscriberKey = s.SubscriberKey', outFields: [T('SubscriberKey', 0)], targetFields: [T('SubscriberKey', 'Text', { isPrimaryKey: true })], updateType: 2 })
    expect(ok.some((c) => /fails Append/.test(c.text))).toBe(false)
  })
})
