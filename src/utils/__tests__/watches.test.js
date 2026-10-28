import { describe, it, expect } from 'vitest'
import { diffAutomation, automationStatusName, addNotices, unreadCount, DEFAULT_ON } from '../watches.js'

describe('watched automations (feedback #50)', () => {
  it('names SFMC status codes and keeps names it does not know', () => {
    expect(automationStatusName(4)).toBe('Paused')
    expect(automationStatusName('6')).toBe('Scheduled')
    expect(automationStatusName(-1)).toBe('Error')
    expect(automationStatusName('Running')).toBe('Running')
    expect(automationStatusName(null)).toBe('')
  })
  it('notices pausing, activation, failed runs; runs only when asked; nothing on the first look', () => {
    const prev = { status: 6, lastRunTime: '2026-10-19T10:00:00', lastRunStatus: 'Complete' }
    expect(diffAutomation(null, prev)).toEqual([])
    expect(diffAutomation(prev, { ...prev, status: 4 }).map((c) => c.kind)).toEqual(['paused'])
    expect(diffAutomation({ ...prev, status: 4 }, prev).map((c) => c.kind)).toEqual(['activated'])
    const ran = { ...prev, lastRunTime: '2026-10-20T10:00:00', lastRunStatus: 'Complete' }
    expect(diffAutomation(prev, ran)).toEqual([])
    expect(diffAutomation(prev, ran, { ...DEFAULT_ON, runs: true }).map((c) => c.kind)).toEqual(['runs'])
    expect(diffAutomation(prev, { ...ran, lastRunStatus: 'Error' }).map((c) => [c.kind, c.text])).toEqual([['fails', 'run failed (Error)']])
    expect(diffAutomation(prev, { ...ran, lastRunStatus: 'Error' }, { ...DEFAULT_ON, fails: false })).toEqual([])
  })
  it('keeps notices newest first and counts unread', () => {
    const w = { stack: 's4', id: 'A1', name: 'Daily' }
    let list = addNotices([], w, [{ kind: 'paused', text: 'is now Paused' }], 1)
    list = addNotices(list, w, [{ kind: 'fails', text: 'run failed' }], 2)
    expect(list.map((n) => n.kind)).toEqual(['fails', 'paused'])
    expect(unreadCount(list)).toBe(2)
    expect(unreadCount([{ ...list[0], read: true }, list[1]])).toBe(1)
  })
})

describe('watched journeys and bulk watch (feedback #59)', async () => {
  const { diffJourney, addWatches, removeWatches, watchKey, noticeRoute, JOURNEY_DEFAULT_ON } = await import('../watches.js')

  it('tells when a journey is paused, published again or gets a new version', () => {
    const prev = { status: 'Published', version: 3, modifiedDate: '2026-10-01T00:00:00Z' }
    expect(diffJourney(prev, { ...prev, status: 'Paused' })).toEqual([{ kind: 'paused', text: 'is now Paused (was Published)' }])
    expect(diffJourney({ ...prev, status: 'Paused' }, prev)).toEqual([{ kind: 'activated', text: 'is now Published (was Paused)' }])
    expect(diffJourney(prev, { ...prev, version: 4 })).toEqual([])
    expect(diffJourney(prev, { ...prev, version: 4 }, { ...JOURNEY_DEFAULT_ON, edited: true })[0]).toMatchObject({ kind: 'edited' })
    expect(diffJourney(null, prev)).toEqual([])
  })

  it('watches several at once, keeps snapshots of ones already watched, and removes them', () => {
    const start = addWatches({}, 's4', 'automation', [{ id: 'A1', name: 'One', status: 6 }], { paused: true })
    const next = addWatches(start, 's4', 'automation', [{ id: 'A1', name: 'One', status: 4 }, { id: 'A2', name: 'Two', status: 2 }], { fails: true })
    expect(next['s4:A1'].last.status).toBe(6)
    expect(next['s4:A1'].on).toEqual({ fails: true })
    expect(next['s4:A2']).toMatchObject({ id: 'A2', name: 'Two', last: { status: 2 } })
    const j = addWatches(next, 's4', 'journey', [{ id: 'j1', key: 'k1', name: 'Welcome', status: 'Published', version: 2 }], JOURNEY_DEFAULT_ON)
    expect(j[watchKey('s4', 'j1', 'journey')]).toMatchObject({ type: 'journey', key: 'k1', last: { status: 'Published', version: 2 } })
    expect(Object.keys(removeWatches(j, 's4', 'automation', ['A1', 'A2']))).toEqual(['s4:journey:j1'])
  })

  it('journey notices link to the journey, older notices to the automation', () => {
    expect(noticeRoute({ type: 'journey', journeyId: 'j1' })).toBe('/journeys/j1')
    expect(noticeRoute({ automationId: 'A1' })).toBe('/automations/A1')
  })
})
