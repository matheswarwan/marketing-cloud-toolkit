// One "Where used" scan at a time for the whole app. The state lives at module level,
// so a scan keeps going while the panel is closed or another section is open.
import { reactive } from 'vue'
import { findUsage, usageStages, clearUsageCache, KINDS, SOURCE_IDS } from '@/utils/usage/index.js'

// Sources the user left out (feedback #70), remembered for later scans.
const SKIP_KEY = 'toolkit_usageSkip'
function readSkip() {
  try { const v = JSON.parse(localStorage.getItem(SKIP_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

const state = reactive({
  open: false,
  target: null,
  stack: null,
  running: false,
  error: '',
  result: null,
  order: [], // [{ id, label }]
  stages: {}, // id → { state, done, total, note }
  history: [], // targets to go back to after following a link in the results
  runId: 0,
  skip: readSkip(), // source ids left out of scans
})

export function targetKey(t) {
  if (!t) return ''
  const id = t.de ? (t.de.id || t.de.customerKey || t.de.name) : t.event?.id || t.asset?.id || t.location?.id || t.activityObjectId || t.id || t.profileType || ''
  return `${t.kind}:${String(id).toLowerCase()}:${t.field || ''}`
}

export const targetTitle = (t) => (t ? KINDS[t.kind].title(t) : '')
export const targetKindLabel = (t) => (t ? (t.de?.dataView ? 'Data view' : KINDS[t.kind].label) : '')

/** Starts a scan (or shows the one already running or finished for the same thing). */
async function start(stack, target, { refresh = false, again = false, keepHistory = false } = {}) {
  state.open = true
  const same = targetKey(state.target) === targetKey(target) && state.stack === stack
  if (same && !refresh && !again && (state.running || state.result)) return
  if (!keepHistory) state.history = []
  const runId = ++state.runId
  const order = usageStages(target)
  Object.assign(state, {
    target, stack, running: true, error: '', result: null, order,
    stages: Object.fromEntries(order.map((s) => [s.id, { state: 'waiting', done: 0, total: 0, note: '' }])),
  })
  try {
    if (refresh) await clearUsageCache(stack)
    const result = await findUsage(stack, target, {
      onStage: (id, s) => { if (runId === state.runId) state.stages[id] = { done: 0, total: 0, note: '', ...s } },
      shouldStop: () => runId !== state.runId,
      isSkipped: (id) => state.skip.includes(id),
    })
    if (runId === state.runId) state.result = result
  } catch (e) {
    if (runId === state.runId) state.error = e.stopped ? 'Stopped.' : e.message
  } finally {
    if (runId === state.runId) state.running = false
  }
}

/** Follows a link in the results to another thing, remembering where it came from. */
function follow(target) {
  if (state.target) state.history.push(state.target)
  start(state.stack, target, { keepHistory: true })
}
function back() {
  const prev = state.history.pop()
  if (prev) start(state.stack, prev, { keepHistory: true })
}

function stop() {
  if (!state.running) return
  state.runId++
  state.running = false
  state.error = 'Stopped.'
  for (const s of Object.values(state.stages)) if (s.state === 'running') s.state = 'stopped'
}

/** Leaves a source out of scans (or brings it back); a running one stops loading now. */
function toggleSkip(id) {
  if (!SOURCE_IDS.includes(id)) return
  state.skip = state.skip.includes(id) ? state.skip.filter((x) => x !== id) : [...state.skip, id]
  try { localStorage.setItem(SKIP_KEY, JSON.stringify(state.skip)) } catch { /* ignore */ }
}
const canSkip = (id) => SOURCE_IDS.includes(id)
/** Runs the same check again without clearing saved data (after changing what to skip). */
function again() {
  if (state.target && !state.running) start(state.stack, state.target, { again: true, keepHistory: true })
}

/** Overall progress 0..1: each stage counts equally, a running one by its share done. */
function progress() {
  const part = (s) => {
    if (!s) return 0
    if (['done', 'skipped', 'cached', 'error'].includes(s.state)) return 1
    if (s.state === 'running' && s.total) return Math.min(1, s.done / s.total)
    return 0
  }
  return state.order.reduce((n, s) => n + part(state.stages[s.id]), 0) / (state.order.length || 1)
}

export function useUsage() {
  return { state, start, stop, follow, back, progress, toggleSkip, canSkip, again }
}
