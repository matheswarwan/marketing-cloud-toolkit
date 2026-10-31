import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchActivitySave, decodeRequestBody, pickActivity, addVersions, makeVersion, recordKey, activityUrl, restoreBody,
  sideBySideDiff, isSpaceOnlyChange, versionsKeyFor, searchRecords,
  looksLikeActivityId, isBadActivityKey,
} from '../activityVersions.js'
import { describeActivity } from '../activityTypes.js'
import { buildBackup, planImport, describeImport } from '../backup.js'

const AS = 'https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3'
const QID = '1a2b3c4d-0000-1111-2222-333344445555'
const bytes = (o) => ({ raw: [{ bytes: new TextEncoder().encode(JSON.stringify(o)).buffer }] })

describe('matchActivitySave (feedback #122)', () => {
  it('matches query and script saves on the documented and legacy-looking paths', () => {
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/queries/${QID}`, 'PATCH')).toEqual({ kind: 'query', id: QID, stack: 's13' })
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/scripts/${QID}?x=1`, 'put')).toEqual({ kind: 'script', id: QID, stack: 's13' })
    expect(matchActivitySave(`${AS}/fuelapi/legacy/v1/beta/automations/queries/${QID}/`, 'POST')).toMatchObject({ kind: 'query', id: QID })
    expect(matchActivitySave(`${AS}/automation/v1/queries/${QID}`, 'PATCH')).toMatchObject({ kind: 'query' })
  })

  it('ignores reads, other activities, lists and other hosts', () => {
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/queries/${QID}`, 'GET')).toBeNull()
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/filters/${QID}`, 'PATCH')).toBeNull()
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/queries/`, 'POST')).toBeNull()
    expect(matchActivitySave(`${AS}/fuelapi/automation/v1/queries/${QID}/actions/start/`, 'POST')).toBeNull()
    expect(matchActivitySave(`https://evil.example.com/AutomationStudioFuel3/queries/${QID}`, 'PATCH')).toBeNull()
  })
})

describe('reading save bodies', () => {
  it('decodes raw JSON (split into parts) and form fields', () => {
    const json = new TextEncoder().encode(JSON.stringify({ queryText: 'SELECT 1' }))
    const raw = { raw: [{ bytes: json.slice(0, 5).buffer }, { bytes: json.slice(5).buffer }] }
    expect(decodeRequestBody(raw)).toEqual({ queryText: 'SELECT 1' })
    expect(decodeRequestBody({ formData: { script: ['x()'], name: ['S'] } })).toEqual({ script: 'x()', name: 'S' })
    expect(decodeRequestBody({ raw: [{ bytes: new TextEncoder().encode('not json').buffer }] })).toBeNull()
  })

  it('keeps the query fields, maps the update type, and finds wrapped bodies', () => {
    expect(pickActivity('query', { name: 'Q', key: 'k', queryText: 'SELECT 1', targetName: 'T', targetKey: 'tk', targetUpdateTypeId: 2 }))
      .toEqual({ name: 'Q', key: 'k', content: 'SELECT 1', targetName: 'T', targetKey: 'tk', targetUpdateType: 'Append' })
    expect(pickActivity('script', { script: { name: 'S', script: 'Platform.Load("core","1")' } }))
      .toEqual({ name: 'S', key: '', content: 'Platform.Load("core","1")' })
    expect(pickActivity('query', { name: 'no sql' })).toBeNull()
  })
})

describe('versions', () => {
  const v = (content, savedAt, extra = {}) => makeVersion({ name: 'Q', content, ...extra }, { savedAt, source: 'saved', stack: 's13' })

  it('skips a version identical to the newest and keeps at most max', () => {
    let r = addVersions([], [v('A', 1), v('A', 2), v('B', 3)], 50)
    expect(r.added).toBe(2)
    expect(r.versions.map((x) => x.content)).toEqual(['B', 'A'])
    r = addVersions(r.versions, [v('B', 4)], 50)
    expect(r.added).toBe(0)
    r = addVersions(r.versions, [v('C', 5), v('D', 6, { targetName: 'T' })], 3)
    expect(r.versions.map((x) => x.content)).toEqual(['D', 'C', 'B'])
    // A changed target alone is a new version; a body without a target is not.
    expect(addVersions(r.versions, [v('D', 7, { targetName: 'Other' })], 3).added).toBe(1)
    expect(addVersions(r.versions, [v('D', 7)], 3).added).toBe(0)
  })

  it('builds keys, URLs and the restore body', () => {
    expect(recordKey('query', 'ABC-123')).toBe('activity_query_abc-123')
    expect(activityUrl('script', 's4', 'x y')).toBe('https://mc.s4.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/scripts/x%20y')
    const body = restoreBody('query', { queryDefinitionId: 'q', name: 'Now', queryText: 'NEW', targetName: 'T', modifiedDate: 'x', status: 'Active' },
      { name: 'Then', content: 'OLD' })
    expect(body).toEqual({ queryDefinitionId: 'q', name: 'Then', queryText: 'OLD', targetName: 'T' })
  })

  it('gives Query and Script activity cards a versions key', () => {
    expect(versionsKeyFor(300, { queryDefinitionId: 'Q1' })).toBe('activity_query_q1')
    expect(versionsKeyFor(423, { ssjsActivityId: 'S1' })).toBe('activity_script_s1')
    expect(versionsKeyFor(303, { filterActivityId: 'F' })).toBeNull()
    expect(describeActivity(300, { queryDefinitionId: 'Q1', queryText: 'SELECT 1', name: 'Q' }, 's13').versionsKey).toBe('activity_query_q1')
  })

  it('searches names, keys and the latest SQL, newest first', () => {
    const recs = [
      { id: 'a', name: 'Daily load', versions: [{ savedAt: 1, content: 'SELECT x FROM Orders' }] },
      { id: 'b', name: 'Cleanup', key: 'CLN', versions: [{ savedAt: 2, content: 'DELETE' }] },
    ]
    expect(searchRecords(recs, '').map((r) => r.id)).toEqual(['b', 'a'])
    expect(searchRecords(recs, 'orders').map((r) => r.id)).toEqual(['a'])
    expect(searchRecords(recs, 'cln').map((r) => r.id)).toEqual(['b'])
  })
})

describe('sideBySideDiff', () => {
  it('lines up unchanged lines and pairs changed ones', () => {
    const rows = sideBySideDiff('SELECT a\nFROM t\nWHERE x = 1', 'SELECT a\nFROM t\nWHERE x = 2\nAND y = 3')
    expect(rows).toEqual([
      { left: 'SELECT a', right: 'SELECT a', type: 'same' },
      { left: 'FROM t', right: 'FROM t', type: 'same' },
      { left: 'WHERE x = 1', right: 'WHERE x = 2', type: 'changed' },
      { left: null, right: 'AND y = 3', type: 'added' },
    ])
    expect(sideBySideDiff('a\nb', 'b').map((r) => r.type)).toEqual(['removed', 'same'])
  })
})

describe('backups include activity versions', () => {
  const rec = { id: 'activity_query_q1', kind: 'query', activityId: 'Q1', versions: [{ versionId: 'v_2_s', savedAt: 2, content: 'B' }] }

  it('exports them with the two settings and merges missing versions on import', () => {
    const b = buildBackup({ activity_query_q1: rec, _activitySaverEnabled: false, other: 1 }, { app: 'x', appVersion: '2.0.12' })
    expect(Object.keys(b.items).sort()).toEqual(['_activitySaverEnabled', 'activity_query_q1'])
    const fresh = planImport(b.items, {})
    expect(fresh.added.activities).toBe(1)
    const older = { ...rec, versions: [{ versionId: 'v_1_s', savedAt: 1, content: 'A' }] }
    const plan = planImport(b.items, { activity_query_q1: older })
    expect(plan.merged.activities).toBe(1)
    expect(plan.writes.activity_query_q1.versions.map((v) => v.versionId)).toEqual(['v_2_s', 'v_1_s'])
    expect(describeImport(plan)).toContain('Added missing versions to 1 activity.')
  })
})

describe('captureActivity (service worker)', () => {
  let store
  let fetched
  let current
  let fetchImpl
  beforeEach(() => {
    vi.resetModules()
    store = { _activitySaverEnabled: true } // off unless turned on
    fetched = []
    current = { queryDefinitionId: QID, name: 'Daily', queryText: 'SELECT old', targetName: 'T', targetUpdateTypeId: 0 }
    vi.doMock('../../background/chromeAsync.js', () => ({
      storageGet: async (area, keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
      storageSet: async (area, o) => { Object.assign(store, o) },
    }))
    fetchImpl = async ({ url }) => { fetched.push(url); return current }
    // One mock with a swappable body: a second vi.doMock of the same path in a test
    // was sometimes ignored, which made the hang test flaky.
    vi.doMock('../../background/fetchProxy.js', () => ({ sfmcFetch: (args) => fetchImpl(args) }))
    vi.doMock('../../background/businessUnit.js', () => ({ fetchCurrentBusinessUnit: async () => ({ name: 'Main BU', accountId: 7 }) }))
  })
  afterEach(() => {
    vi.doUnmock('../../background/chromeAsync.js')
    vi.doUnmock('../../background/fetchProxy.js')
    vi.doUnmock('../../background/businessUnit.js')
  })

  const save = (cap, body, timeStamp = 1000, method = 'PATCH') => cap({ method, url: `${AS}/fuelapi/automation/v1/queries/${QID}`, timeStamp, requestBody: bytes(body) })

  it('stores the version before the save and the saved one, then only new content', async () => {
    const { captureActivity } = await import('../../background/activityCapture.js')
    await save(captureActivity, { name: 'Daily', queryText: 'SELECT new', targetName: 'T', targetUpdateTypeId: 0 })
    await new Promise((r) => setTimeout(r, 0))
    const key = `activity_query_${QID}`
    expect(fetched).toEqual([`${AS}/fuelapi/automation/v1/queries/${QID}`])
    expect(store[key].versions.map((v) => [v.source, v.content])).toEqual([['saved', 'SELECT new'], ['before-save', 'SELECT old']])
    expect(store[key]).toMatchObject({ kind: 'query', activityId: QID, name: 'Daily', stack: 's13', businessUnit: { name: 'Main BU' } })
    // The save won the race: the read returns the new text; nothing new is stored.
    current = { ...current, queryText: 'SELECT new' }
    await save(captureActivity, { name: 'Daily', queryText: 'SELECT new' }, 2000)
    expect(store[key].versions).toHaveLength(2)
  })

  it('stores the saved version when the read before it hangs', async () => {
    fetchImpl = () => new Promise(() => {})
    const { captureActivity, captureTiming } = await import('../../background/activityCapture.js')
    captureTiming.beforeReadMs = 30
    await save(captureActivity, { name: 'Daily', queryText: 'SELECT new' })
    await vi.waitFor(() => expect(store[`activity_query_${QID}`]).toBeTruthy(), { timeout: 2000 })
    expect(store[`activity_query_${QID}`].versions.map((v) => v.source)).toEqual(['saved'])
  })

  it('reads the saved version after the save completes when Chrome gives no body (PATCH)', async () => {
    const { captureActivity, activitySaveCompleted } = await import('../../background/activityCapture.js')
    const run = captureActivity({ method: 'PATCH', requestId: 'r1', url: `${AS}/fuelapi/automation/v1/queries/${QID}`, timeStamp: 5 })
    await new Promise((r) => setTimeout(r, 0))
    current = { ...current, queryText: 'SELECT after' } // the save landed
    activitySaveCompleted({ requestId: 'r1', statusCode: 200 })
    await run
    expect(fetched).toHaveLength(2)
    expect(store[`activity_query_${QID}`].versions.map((v) => [v.source, v.content])).toEqual([['saved', 'SELECT after'], ['before-save', 'SELECT old']])
    // A failed save stores nothing new.
    const run2 = captureActivity({ method: 'PATCH', requestId: 'r2', url: `${AS}/fuelapi/automation/v1/queries/${QID}`, timeStamp: 6 })
    current = { ...current, queryText: 'SELECT broken' }
    activitySaveCompleted({ requestId: 'r2', statusCode: 400 })
    await run2
    expect(store[`activity_query_${QID}`].versions).toHaveLength(2)
  })

  it('respects the setting and the version limit, and ignores reads', async () => {
    const { captureActivity } = await import('../../background/activityCapture.js')
    store._activitySaverEnabled = false
    await save(captureActivity, { queryText: 'SELECT 1' })
    expect(Object.keys(store)).toEqual(['_activitySaverEnabled'])
    store._activitySaverEnabled = true
    store._activityMaxVersions = 2
    await save(captureActivity, { queryText: 'SELECT 1' }, 1)
    current = { ...current, queryText: 'SELECT 1' } // what SFMC holds before the next save
    await save(captureActivity, { queryText: 'SELECT 2' }, 2)
    expect(store[`activity_query_${QID}`].versions.map((v) => v.content)).toEqual(['SELECT 2', 'SELECT 1'])
    expect(await captureActivity({ method: 'GET', url: `${AS}/fuelapi/automation/v1/queries/${QID}` })).toBeUndefined()
  })
})

describe('wider save patterns (feedback #129)', () => {
  const id = 'a1b2c3d4-0000-1111-2222-333344445555'
  it.each([
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/scripts/' + id, 'script'],
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/legacy/v1/beta/automations/ssjs/' + id, 'script'],
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/ssjsactivities/' + id, 'script'],
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/api/scriptactivities/' + id, 'script'],
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/querydefinitions/' + id, 'query'],
    ['https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/api/queryactivities/' + id + '?x=1', 'query'],
    ['https://mc.s13.exacttarget.com/cloud/AutomationStudioFuel3/fuelapi/automation/v1/queries/' + id, 'query'],
  ])('matches %s', (url, kind) => {
    expect(matchActivitySave(url, 'PATCH')).toEqual({ kind, id, stack: 's13' })
  })
  it('still ignores reads, other apps and paths without an id', () => {
    expect(matchActivitySave(`https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/scripts/${id}`, 'GET')).toBeNull()
    expect(matchActivitySave(`https://mc.s13.marketingcloudapps.com/ContentBuilder/fuelapi/automation/v1/scripts/${id}`, 'PATCH')).toBeNull()
    expect(matchActivitySave('https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/scripts/', 'POST')).toBeNull()
  })
})

describe('path words are not activity ids (feedback #130)', () => {
  const AS13 = 'https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1'
  const guid = '9f1c2d3e-4b5a-6789-abcd-ef0123456789'
  it('rejects /scripts/validate and other verbs', () => {
    for (const v of ['validate', 'validation', 'run', 'start', 'stop', 'pause', 'perform', 'actions', 'search', 'copy', 'preview', 'test', 'execute', 'status']) {
      expect(matchActivitySave(`${AS13}/scripts/${v}`, 'POST')).toBeNull()
      expect(matchActivitySave(`${AS13}/queries/${v}`, 'POST')).toBeNull()
    }
  })
  it('accepts /scripts/<guid> and rejects /scripts/<guid>/validate', () => {
    expect(matchActivitySave(`${AS13}/scripts/${guid}`, 'PATCH')).toEqual({ kind: 'script', id: guid, stack: 's13' })
    expect(matchActivitySave(`${AS13}/scripts/${guid}/validate`, 'POST')).toBeNull()
  })
  it('tells stored records made from a verb apart', () => {
    expect(looksLikeActivityId('validate')).toBe(false)
    expect(looksLikeActivityId('abcdefgh')).toBe(false)
    expect(looksLikeActivityId(guid)).toBe(true)
    expect(isBadActivityKey('activity_script_validate')).toBe(true)
    expect(isBadActivityKey(`activity_query_${guid}`)).toBe(false)
    expect(isBadActivityKey('sql_123')).toBe(false)
  })
})

describe('isSpaceOnlyChange', () => {
  it('flags changed lines that differ only in spaces or tabs', () => {
    const rows = sideBySideDiff('SELECT a\n  FROM t\nWHERE x = 1', 'SELECT a\n\tFROM  t  \nWHERE x = 2')
    expect(rows.map(isSpaceOnlyChange)).toEqual([false, true, false])
  })
  it('ignores same, added and removed rows', () => {
    expect(isSpaceOnlyChange({ type: 'added', left: null, right: ' ' })).toBe(false)
    expect(isSpaceOnlyChange({ type: 'same', left: 'a', right: 'a' })).toBe(false)
  })
})
