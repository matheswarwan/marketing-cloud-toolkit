// "Where used": runs one kind's analysis (kinds.js), loading the sources it asks for
// (sources.js) one after another. Data is saved per stack and business unit
// (store.js), so it survives new tabs and restarts:
//   - saved less than 5 minutes ago: used as is, no SFMC call;
//   - saved earlier: brought up to date with the source's refresh() (only changes);
//   - nothing saved, or Rescan: read in full.
// Progress goes to onStage(id, { state, done, total, note }) with state 'running' |
// 'done' | 'cached' | 'skipped' | 'error'. A source that fails does not end the scan:
// its stage shows the error and its sections say they may be incomplete.
// isSkipped(sourceId) (feedback #70) leaves a source out, checked before it loads and
// while it loads (Skip): its saved data is used if there is any, else it returns null
// like a failed source. A skipped load is never saved, so saved data stays whole.
import { KINDS } from './kinds.js'
import { SOURCES, StoppedError } from './sources.js'
import { loadSaved, save, forget, peekSaved } from './store.js'
import { fetchCurrentBU } from '../sfmcApi.js'

export { KINDS, PROFILE_LABELS } from './kinds.js'
export const SOURCE_IDS = Object.keys(SOURCES)
export { StoppedError }

export const REUSE_FOR = 5 * 60 * 1000
const count = (v) => ({ done: v?.items?.length ?? 0, total: v?.total ?? v?.items?.length ?? 0 })

// The business unit is part of every key: the same stack serves several BUs.
const buCache = new Map() // stack → { id, at }
async function businessUnit(stack, now) {
  const c = buCache.get(stack)
  if (c && now() - c.at < 60 * 1000) return c.id
  const bu = await fetchCurrentBU(stack).catch(() => null)
  const id = String(bu?.accountId ?? 'unknown')
  buCache.set(stack, { id, at: now() })
  return id
}

/** Forgets saved Where used data for a stack (every business unit), or all. */
export async function clearUsageCache(stack) {
  buCache.delete(stack)
  await forget(stack ? `${stack}:` : '')
}

export function usageStages(target) {
  return KINDS[target.kind].stages(target)
}

const ago = (ms) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'less than a minute ago' : m === 1 ? '1 minute ago' : m < 120 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`
}

/** @returns {Promise<{ sections, note?, title?, businessUnit }>} */
export async function findUsage(stack, target, { onStage = () => {}, shouldStop = () => false, isSkipped = () => false, now = () => Date.now() } = {}) {
  const kind = KINDS[target.kind]
  if (!kind) throw new Error(`Unknown kind: ${target.kind}`)
  const touched = new Set()
  const loading = {}
  const values = {}
  const report = (id, s) => { touched.add(id); onStage(id, s) }
  const checkStop = () => { if (shouldStop()) throw new StoppedError() }
  const bu = await businessUnit(stack, now)
  checkStop()
  const keyOf = (id) => `${stack}:${bu}:${id}`

  const ctx = {
    stack,
    stop: shouldStop,
    checkStop,
    stage: report,
    /** A source already loaded in this scan or saved in memory (no SFMC call), or null. */
    peek: (id) => values[id] || peekSaved(keyOf(id))?.value || null,
    get(id) {
      if (loading[id]) return loading[id]
      const src = SOURCES[id]
      loading[id] = (async () => {
        checkStop()
        const saved = await loadSaved(keyOf(id))
        const skip = () => {
          if (saved) {
            report(id, { state: 'cached', ...count(saved.value), note: `skipped, using data saved ${ago(now() - saved.savedAt)}` })
            values[id] = saved.value
            return saved.value
          }
          report(id, { state: 'skipped', done: 0, total: 0, note: 'results may be incomplete' })
          return null
        }
        if (isSkipped(id)) return skip()
        if (saved && now() - saved.savedAt < REUSE_FOR) {
          report(id, { state: 'cached', ...count(saved.value), note: `saved ${ago(now() - saved.savedAt)}` })
          values[id] = saved.value
          return saved.value
        }
        report(id, { state: 'running', done: 0, total: 0, note: saved ? 'checking for changes' : '' })
        const loaderCtx = {
          stack,
          stop: () => shouldStop() || isSkipped(id),
          get: ctx.get,
          progress: (done, total, note = '') => { if (!shouldStop()) report(id, { state: 'running', done, total, note }) },
        }
        try {
          let value
          let note = ''
          if (saved && src.refresh) {
            const r = await src.refresh(saved.value, loaderCtx)
            value = r.value
            note = r.changed == null ? 'read again in full' : r.changed ? `${r.changed} changed since the last scan` : 'no changes since the last scan'
          } else {
            value = await src.load(loaderCtx)
          }
          checkStop()
          await save(keyOf(id), value)
          if (value.errors) note = [note, `${value.errors} could not be read`].filter(Boolean).join(', ')
          if (value.unavailable) note = 'not available in this account'
          else if (value.capped) note = [note, 'capped'].filter(Boolean).join(', ')
          report(id, { state: 'done', ...count(value), note })
          values[id] = value
          return value
        } catch (e) {
          if (shouldStop()) throw new StoppedError()
          if (isSkipped(id)) return skip()
          if (e?.stopped) throw new StoppedError()
          report(id, { state: 'error', done: 0, total: 0, note: e.message })
          return null
        }
      })()
      return loading[id]
    },
  }

  const result = await kind.analyze(target, ctx)
  checkStop()
  const found = (result.sections || []).reduce((n, s) => n + (s.items?.length || 0), 0)
  report('analyse', { state: 'done', done: 0, total: 0, note: `${found} found` })
  for (const s of kind.stages(target)) if (!touched.has(s.id)) onStage(s.id, { state: 'skipped', done: 0, total: 0, note: 'not needed' })
  return { ...result, businessUnit: bu }
}
