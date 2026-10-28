// A running automation's progress (feedback #123): "Running step X of Y" like Automation
// Studio's Activity tab, and a light poller that keeps it current while the page is open.
//
// The field that says which step is running has not been seen in a live response yet,
// so the step is read from the likely names on the automation, on its latest run, on
// its steps, or on the run's activity instances. Without one, it says "Running" and
// the bar keeps moving without a position.

import { automationStatusName } from './watches.js'

export const isRunningStatus = (s) => /^running$|executing|in ?progress/i.test(automationStatusName(s))

const STEP_FIELDS = ['currentStep', 'currentStepNumber', 'runningStep', 'runningStepNumber', 'stepNumber', 'step']
const STEP_INDEX_FIELDS = ['currentStepIndex', 'runningStepIndex']
const ACTIVE = /running|executing|in ?progress|active|started/i

const getCI = (o, name) => {
  if (!o || typeof o !== 'object') return undefined
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase())
  return k == null ? undefined : o[k]
}
const posInt = (v) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function stepFrom(o) {
  for (const f of STEP_FIELDS) {
    const n = posInt(getCI(o, f))
    if (n) return n
  }
  for (const f of STEP_INDEX_FIELDS) {
    const n = posInt(getCI(o, f))
    if (n != null) return n + 1
  }
  return null
}

// The first running step in a list of steps or activity instances.
function stepFromList(list) {
  if (!Array.isArray(list)) return null
  for (let i = 0; i < list.length; i++) {
    const s = getCI(list[i], 'status') ?? getCI(list[i], 'statusName')
    if (s != null && ACTIVE.test(automationStatusName(s)) && !/inactive/i.test(String(s))) {
      return stepFrom(list[i]) || posInt(getCI(list[i], 'step')) || i + 1
    }
  }
  return null
}

/**
 * Where an automation's run is. `details` is the automation (REST or list record),
 * `run` its latest run record (raw, from the run log) when there is one.
 * Returns { running, status, step, total, label }; step and total may be null.
 */
export function automationRunState(details, run = null) {
  const status = automationStatusName(details?.status ?? details?.statusId)
  const runStatus = run ? automationStatusName(getCI(run, 'status') ?? getCI(run, 'statusName')) : ''
  const running = isRunningStatus(status) || (!!runStatus && isRunningStatus(runStatus))
  const steps = Array.isArray(details?.steps) ? details.steps : null
  const total = steps?.length || posInt(getCI(details, 'stepCount')) || posInt(getCI(run, 'stepCount')) || null
  let step = null
  if (running) {
    step = stepFrom(details) || stepFrom(run) || stepFromList(steps)
      || stepFromList(getCI(run, 'activityInstances')) || stepFromList(getCI(run, 'activities')) || stepFromList(getCI(run, 'steps'))
    if (step && total && step > total) step = null
  }
  const label = !running ? status
    : step && total ? `Running step ${step} of ${total}`
    : total ? `Running (${total} ${total === 1 ? 'step' : 'steps'})`
    : 'Running'
  return { running, status, step, total, label }
}

/**
 * Calls `tick` every `interval` ms while `shouldContinue()` is true. Waits for each tick
 * to finish before planning the next, skips ticks while the page is hidden (and ticks
 * once when it shows again), and stops for good on stop().
 */
export function createPoller({ interval = 5000, tick, shouldContinue = () => true, doc = globalThis.document } = {}) {
  let timer = null
  let stopped = true
  let busy = false

  const schedule = () => {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(run, interval)
  }
  async function run() {
    if (stopped || busy) return
    if (doc?.hidden) return // resumed by visibilitychange
    busy = true
    try { await tick() } catch { /* the next tick tries again */ } finally { busy = false }
    if (!stopped && !shouldContinue()) stop()
    else schedule()
  }
  const onVisible = () => { if (!stopped && !doc.hidden) { clearTimeout(timer); run() } }

  function start() {
    if (!stopped) return
    stopped = false
    doc?.addEventListener?.('visibilitychange', onVisible)
    schedule()
  }
  function stop() {
    stopped = true
    clearTimeout(timer)
    timer = null
    doc?.removeEventListener?.('visibilitychange', onVisible)
  }
  return { start, stop, get running() { return !stopped } }
}
