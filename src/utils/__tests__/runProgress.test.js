// Running bar (feedback #123): step X of Y and the poller.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { automationRunState, createPoller, isRunningStatus } from '../runProgress.js'
import { activityIconKind } from '../activityIcons.js'

const steps = [{ activities: [] }, { activities: [] }, { activities: [] }]

describe('automationRunState', () => {
  it('reads numeric and named statuses', () => {
    expect(isRunningStatus(3)).toBe(true)
    expect(isRunningStatus('Running')).toBe(true)
    expect(isRunningStatus('Scheduled')).toBe(false)
    expect(automationRunState({ status: 6, steps }).label).toBe('Scheduled')
  })

  it('gives step X of Y from a step field on the automation or its run', () => {
    expect(automationRunState({ status: 'Running', steps, currentStep: 2 }).label).toBe('Running step 2 of 3')
    expect(automationRunState({ status: 3, steps }, { status: 'Running', CurrentStepIndex: 0 }).label).toBe('Running step 1 of 3')
  })

  it('finds the running step in the steps or the run activity instances', () => {
    const s = [{ status: 'Complete' }, { status: 'Running' }, { status: 'Waiting' }]
    expect(automationRunState({ status: 'Running', steps: s }).step).toBe(2)
    const run = { status: 'Running', activityInstances: [{ status: 'Complete', stepNumber: 1 }, { status: 'Executing', stepNumber: 3 }] }
    expect(automationRunState({ status: 'Running', steps }, run).label).toBe('Running step 3 of 3')
  })

  it('says Running without a position when no step is known, and drops impossible steps', () => {
    expect(automationRunState({ status: 'Running', steps }).label).toBe('Running (3 steps)')
    expect(automationRunState({ status: 'Running' }).label).toBe('Running')
    expect(automationRunState({ status: 'Running', steps, currentStep: 9 }).step).toBeNull()
  })

  it('counts a running latest run when the automation status lags', () => {
    expect(automationRunState({ status: 'Scheduled', steps }, { status: 'Running' }).running).toBe(true)
  })
})

describe('createPoller', () => {
  afterEach(() => vi.useRealTimers())
  const fakeDoc = () => {
    const l = {}
    return { hidden: false, addEventListener: (t, f) => { l[t] = f }, removeEventListener: (t) => { delete l[t] }, fire: (t) => l[t]?.(), l }
  }

  it('ticks every interval and stops once shouldContinue is false', async () => {
    vi.useFakeTimers()
    let n = 0
    const p = createPoller({ interval: 5000, tick: async () => { n++ }, shouldContinue: () => n < 2, doc: fakeDoc() })
    p.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(n).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(n).toBe(2)
    expect(p.running).toBe(false)
    await vi.advanceTimersByTimeAsync(20000)
    expect(n).toBe(2)
  })

  it('skips ticks while hidden, ticks when shown, and stop() ends it', async () => {
    vi.useFakeTimers()
    const doc = fakeDoc()
    let n = 0
    const p = createPoller({ interval: 1000, tick: async () => { n++ }, doc })
    doc.hidden = true
    p.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(n).toBe(0)
    doc.hidden = false
    doc.fire('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(n).toBe(1)
    p.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(n).toBe(1)
    expect(doc.l.visibilitychange).toBeUndefined()
  })

  it('keeps going after a failed tick', async () => {
    vi.useFakeTimers()
    let n = 0
    const p = createPoller({ interval: 1000, tick: async () => { n++; throw new Error('x') }, doc: fakeDoc() })
    p.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(n).toBe(2)
    p.stop()
  })
})

describe('activityIconKind', () => {
  it('maps type ids and names', () => {
    expect(activityIconKind(300)).toBe('query')
    expect(activityIconKind('423')).toBe('script')
    expect(activityIconKind('SQL Query')).toBe('query')
    expect(activityIconKind('Data Extract')).toBe('extract')
    expect(activityIconKind('File Transfer')).toBe('transfer')
    expect(activityIconKind('Send Email activity')).toBe('email')
    expect(activityIconKind(99999)).toBe('other')
    expect(activityIconKind(null)).toBe('other')
  })
})
