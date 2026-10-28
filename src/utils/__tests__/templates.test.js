import { describe, it, expect, vi, beforeEach } from 'vitest'
import { orphanContacts } from '../templates/orphanContacts.js'
import { dataViewArchive, archiveFields } from '../templates/dataViewArchive.js'

describe('Orphan contacts template', () => {
  const o = { ...orphanContacts.defaults }

  it('plans the pending DE (sendable), both checks in order, archive last', () => {
    const p = orphanContacts.plan(o)
    expect(p.des.map((d) => d.name)).toEqual(['Contact Deletion Pending', 'Contact Deletion Archive'])
    expect(p.des[0]).toMatchObject({ key: 'contact-deletion-pending-de', sendableField: 'SubscriberKey' })
    expect(p.queries.map((q) => [q.ref, q.updateType, q.target])).toEqual([['leadsUsers', 0, 'pending'], ['contacts', 1, 'pending'], ['archive', 1, 'archive']])
    expect(p.automation.steps.map((s) => s.queries)).toEqual([['leadsUsers'], ['contacts'], ['archive']])
  })

  it('reads the list by name and only flags CRM IDs', () => {
    const p = orphanContacts.plan({ ...o, listName: 'My List' })
    expect(p.queries[0].sql).toContain('FROM [My List] AS contact')
    expect(p.queries[0].sql).toMatch(/LIKE '005%' AND sfUser\.Id IS NULL/)
    expect(p.queries[0].sql).toMatch(/LIKE '00Q%' AND lead\.Id IS NULL/)
    expect(p.queries[1].sql).toMatch(/LIKE '003%' AND crm\.Id IS NULL/)
  })

  it('a single check overwrites; no check is refused', () => {
    const p = orphanContacts.plan({ ...o, checkLeadsUsers: false, archive: false })
    expect(p.queries.map((q) => [q.ref, q.updateType])).toEqual([['contacts', 0]])
    expect(() => orphanContacts.plan({ ...o, checkLeadsUsers: false, checkContacts: false })).toThrow('Pick at least one check')
  })
})

describe('Data view archive template', () => {
  it('keys each archive DE on the event and copies the last N days with Update', () => {
    const p = dataViewArchive.plan({ ...dataViewArchive.defaults, views: ['_Sent', '_Click', '_Job'], days: 5 })
    expect(p.des.map((d) => d.name)).toEqual(['Archive_Sent', 'Archive_Click', 'Archive_Job'])
    const keys = (name) => p.des.find((d) => d.name === name).fields.filter((f) => f.isPrimaryKey).map((f) => f.name)
    expect(keys('Archive_Sent')).toEqual(['JobID', 'ListID', 'BatchID', 'SubscriberID', 'EventDate'])
    expect(keys('Archive_Click')).toContain('LinkName')
    expect(keys('Archive_Job')).toEqual(['JobID'])
    expect(p.queries.every((q) => q.updateType === 1)).toBe(true)
    expect(p.queries[0].sql).toContain('WHERE EventDate >= DATEADD(day, -5, GETDATE())')
    expect(p.queries[1].sql).toContain("LEFT(ISNULL(LinkName, ''), 500) AS LinkName")
    expect(p.queries[1].sql).toContain("ROW_NUMBER() OVER (PARTITION BY JobID, ListID, BatchID, SubscriberID, CONVERT(DATETIME, CONVERT(CHAR(19), EventDate, 120), 120), LEFT(ISNULL(LinkName, ''), 500) ORDER BY EventDate DESC)")
    expect(p.queries[1].sql).toMatch(/WHERE RowNum = 1$/)
    expect(p.queries[1].sql).toContain('LEFT(URL, 4000) AS URL')
    expect(p.queries[2].sql).toContain('WHERE CreatedDate >=')
    expect(p.automation.steps).toHaveLength(1)
  })

  it('maps data view types and keeps key fields not nullable', () => {
    const f = Object.fromEntries(archiveFields('_Open').map((x) => [x.name, x]))
    expect(f.EventDate).toMatchObject({ type: 'date', isPrimaryKey: true, isNullable: false })
    expect(f.IsUnique).toMatchObject({ type: 'boolean', isNullable: true })
    expect(f.SubscriberKey).toMatchObject({ type: 'text', length: 254 })
  })
})

describe('createFromPlan', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  function stub(handler) {
    const calls = []
    vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
      calls.push(msg)
      Promise.resolve(handler(msg)).then((data) => cb(data instanceof Error ? { error: data.message } : { data }))
    } } })
    return calls
  }
  const answer = (msg) => {
    if (msg.url.includes('/folder?')) return { entry: [{ id: '100', name: 'Data Extensions', type: 'dataextension' }] }
    if (msg.url.includes('/folders/?')) return { items: [{ categoryId: 7, name: 'Query', parentId: 0 }] }
    if (msg.url.endsWith('/customobjects/')) return { id: `de-${msg.body.name}`, customerKey: msg.body.customerKey }
    if (msg.url.endsWith('/automation/v1/queries')) return { queryDefinitionId: `q-${msg.body.name}` }
    if (msg.url.endsWith('/automation/v1/automations')) return { id: 'auto-1' }
    return {}
  }

  it('creates DEs, queries and an unscheduled automation wired together', async () => {
    const calls = stub(answer)
    const { createFromPlan } = await import('../templates/index.js')
    const plan = orphanContacts.plan({ ...orphanContacts.defaults, archive: false })
    const r = await createFromPlan('s13', plan)
    expect(r.failed).toBeNull()
    expect(r.created.map((c) => c.kind)).toEqual(['de', 'query', 'query', 'automation'])
    const de = calls.find((c) => c.url.endsWith('/customobjects/')).body
    expect(de).toMatchObject({ isSendable: true, sendableCustomObjectField: 'SubscriberKey', categoryID: 100, customerKey: 'contact-deletion-pending-de' })
    const qs = calls.filter((c) => c.url.endsWith('/automation/v1/queries')).map((c) => c.body)
    expect(qs.map((q) => [q.targetUpdateTypeName, q.targetId, q.categoryId])).toEqual([['Overwrite', 'de-Contact Deletion Pending', 7], ['Update', 'de-Contact Deletion Pending', 7]])
    const auto = calls.find((c) => c.url.endsWith('/automation/v1/automations')).body
    expect(auto.steps.map((s) => s.activities.map((a) => a.activityObjectId))).toEqual([[`q-${qs[0].name}`], [`q-${qs[1].name}`]])
    expect(auto.schedule).toBeUndefined()
    expect(calls.some((c) => /start|run/i.test(c.url.split('/fuelapi')[1] || ''))).toBe(false)
  })

  it('stops at the first failure and reports what was created', async () => {
    stub((msg) => (msg.url.endsWith('/automation/v1/queries') ? new Error('SFMC API error 400: invalid object name AllContactsList') : answer(msg)))
    const { createFromPlan } = await import('../templates/index.js')
    const r = await createFromPlan('s13', orphanContacts.plan(orphanContacts.defaults))
    expect(r.created.map((c) => c.kind)).toEqual(['de', 'de'])
    expect(r.failed).toMatchObject({ kind: 'query', status: 'failed' })
    expect(r.failed.error).toContain('AllContactsList')
  })

  it('creates a non-sendable DE when SFMC refuses the sendable settings', async () => {
    let first = true
    stub((msg) => {
      if (msg.url.endsWith('/customobjects/') && msg.body.isSendable && first) { first = false; return new Error('SFMC API error 400: sendable relationship invalid') }
      return answer(msg)
    })
    const { createFromPlan } = await import('../templates/index.js')
    const r = await createFromPlan('s13', orphanContacts.plan({ ...orphanContacts.defaults, archive: false, checkContacts: false }))
    expect(r.created[0].note).toMatch(/not sendable/)
  })

  it('checks the queries first and creates nothing when one is invalid (feedback #44)', async () => {
    const calls = stub((msg) => {
      if (msg.url.includes('/automation/v1/queries/?')) return { items: [{ queryDefinitionId: 'any-q', name: 'Daily' }] }
      if (msg.url.includes('/actions/validate/')) {
        return msg.body.text.includes('[AllContactsList]')
          ? { queryValid: false, errors: [{ message: '[AllContactsList] is not a known data extension or system data view.<br /> [Lead_Salesforce] is not known.' }] }
          : { queryValid: true }
      }
      return answer(msg)
    })
    const { createFromPlan } = await import('../templates/index.js')
    const r = await createFromPlan('s13', orphanContacts.plan(orphanContacts.defaults))
    expect(r.created).toEqual([])
    expect(r.failed.kind).toBe('check')
    expect(r.failed.error).toContain('[AllContactsList] is not a known data extension')
    expect(r.failed.error).not.toContain('<br')
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/customobjects/'))).toBe(false)
    // The archive query reads the plan's own Pending DE, so it is not sent for checking.
    expect(calls.filter((c) => c.url.includes('/actions/validate/')).length).toBe(2)
  })

  it('deletes what a stopped run created, automation first', async () => {
    const calls = stub(() => ({}))
    const { deleteCreated } = await import('../templates/index.js')
    const failed = await deleteCreated('s13', [
      { kind: 'de', id: 'd1', name: 'A' }, { kind: 'query', id: 'q1', name: 'B' }, { kind: 'automation', id: 'a1', name: 'C' }, { kind: 'de', id: null, name: 'D' },
    ])
    expect(calls.map((c) => c.method + ' ' + c.url.split('/fuelapi')[1])).toEqual([
      'DELETE /automation/v1/automations/a1', 'DELETE /automation/v1/queries/q1', 'DELETE /internal/v1/customobjects/d1'])
    expect(failed.map((f) => f.name)).toEqual(['D'])
  })
})

describe('Data view archive fields (feedback #43)', () => {
  it('stores Email fields as Text(254) so SFMC accepts the DE', () => {
    const f = Object.fromEntries(archiveFields('_Job').map((x) => [x.name, x]))
    expect(f.BccEmail).toMatchObject({ type: 'text', length: 254 })
    expect(f.FromEmail).toMatchObject({ type: 'text', length: 254 })
  })

  it('stores _Job DynamicEmailSubject and EventID as text (feedback #56)', () => {
    const f = Object.fromEntries(archiveFields('_Job').map((x) => [x.name, x]))
    expect(f.DynamicEmailSubject).toMatchObject({ type: 'text', length: 4000 })
    expect(f.EventID).toMatchObject({ type: 'text' })
  })
})

describe('more templates (user, 2026-10-20)', () => {
  it('unengaged: sent in the window, no open or click, at least N sends; sendable', async () => {
    const { unengagedSubscribers: t } = await import('../templates/engagement.js')
    const p = t.plan({ ...t.defaults, days: 60, minSends: 4 })
    expect(p.des[0]).toMatchObject({ name: 'Unengaged Subscribers', sendableField: 'SubscriberKey' })
    const sql = p.queries[0].sql
    expect(sql).toContain('DATEADD(day, -60, GETDATE())')
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM _Open/)
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM _Click/)
    expect(sql).toContain('HAVING COUNT(*) >= 4')
    expect(sql).toContain('LEFT JOIN _Subscribers')
    expect(t.plan({ ...t.defaults, fromParent: true }).queries[0].sql).toContain('LEFT JOIN ENT._Subscribers')
  })
  it('held and bouncing: held/bounced status or recent hard bounces', async () => {
    const { heldBounced: t } = await import('../templates/engagement.js')
    const sql = t.plan(t.defaults).queries[0].sql
    expect(sql).toMatch(/LOWER\(sub\.Status\) IN \('held', 'bounced'\) OR b\.HardBounces > 0/)
    expect(sql).toContain("BounceCategory LIKE 'Hard%'")
  })
  it('automation run log: runs and activities keyed on their instance IDs, upserted', async () => {
    const { automationRunLog: t } = await import('../templates/engagement.js')
    const p = t.plan(t.defaults)
    expect(p.des.map((d) => d.fields.filter((f) => f.isPrimaryKey).map((f) => f.name))).toEqual([['AutomationInstanceID'], ['ActivityInstanceID']])
    expect(p.queries.map((q) => q.updateType)).toEqual([1, 1])
    expect(p.queries[0].sql).toContain('FROM _AutomationInstance')
    expect(p.des[0].fields.find((f) => f.name === 'AutomationInstanceStartTime_UTC').type).toBe('date')
  })
  it('unsubscribes for CRM: email and business unit unsubscribes, upserted by subscriber', async () => {
    const { crmUnsubscribes: t } = await import('../templates/engagement.js')
    const p = t.plan({ ...t.defaults, days: 3 })
    expect(p.queries[0].updateType).toBe(1)
    expect(p.queries[0].sql).toContain('FROM _Unsubscribe')
    expect(p.queries[0].sql).toContain('FROM _BusinessUnitUnsubscribes')
    expect(p.queries[0].sql).toContain('DATEADD(day, -3, GETDATE())')
  })
  it('every template is listed and plans with its defaults', async () => {
    const { TEMPLATES } = await import('../templates/index.js')
    expect(TEMPLATES.map((t) => t.id)).toEqual(['orphan-contacts', 'data-view-archive', 'unengaged-subscribers', 'held-bounced', 'automation-run-log', 'crm-unsubscribes'])
    for (const t of TEMPLATES) expect(() => t.plan({ ...t.defaults })).not.toThrow()
  })
})
