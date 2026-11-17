import { ref, watch, getCurrentScope, onScopeDispose } from 'vue'
import { detectStack, readCachedStack, onStackChange } from '@/utils/stackDetection.js'

// The current SFMC stack, shared by every section. Starts from the cached stack
// (confirmed by the service worker), follows the stack picker and stacks the service
// worker drops after an auth failure.
//
// While no stack is known (the tab was opened before logging in to SFMC, or after the
// session ended), detection runs again every RETRY_MS and when the tab gets focus. Logging
// in does not always change the cached stack value (it can stay 's10'), so storage events
// alone never told the page: SOAP pages stayed on "Unknown stack" until the tab was
// reloaded (found live on s10, 2026-11-17).
export const RETRY_MS = 5000

const stack = ref(null)
const state = ref('detecting') // detecting | connected | disconnected
let started = false
let retryTimer = null

async function detect() {
  const live = await detectStack().catch(() => null)
  if (live) { stack.value = live; state.value = 'connected' }
  else if (!stack.value) state.value = 'disconnected'
  keepLooking()
  return live
}

// Retries detection while there is no stack; stops once there is one.
function keepLooking() {
  if (stack.value) { clearTimeout(retryTimer); retryTimer = null; return }
  if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; if (!stack.value) detect() }, RETRY_MS)
}

function onFocus() {
  if (!stack.value && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) detect()
}

export function useStack() {
  if (!started) {
    started = true
    readCachedStack().then(({ stack: cached, isFresh }) => {
      if (isFresh && cached) { stack.value = cached; state.value = 'connected' }
      return detect()
    })
    onStackChange((s) => {
      if (s) { stack.value = s; state.value = 'connected'; keepLooking() } else detect()
    })
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onFocus)
  }
  return { stack, state, detect }
}

// Runs `fn` now if the stack is known, else once it is (searches opened from Ctrl+K
// in a fresh tab arrive before detection finishes). After 15 seconds without a stack,
// `fn` runs anyway so the page can say it has no session (noStackError), and runs again
// when a stack turns up.
export function whenStack(fn) {
  useStack()
  if (stack.value) return fn()
  const stop = watch(stack, (s) => { if (s) { stop(); clearTimeout(timer); fn() } })
  const timer = setTimeout(() => { if (!stack.value) fn() }, 15000)
  // A page that is left stops waiting (the watch would otherwise load it later).
  if (getCurrentScope()) onScopeDispose(() => { stop(); clearTimeout(timer) })
}

/** The current stack ref without starting detection (icons that load per stack read it). */
export const currentStack = stack

/** Tests only: forget the shared state. */
export function resetStackForTests() {
  clearTimeout(retryTimer); retryTimer = null
  stack.value = null; state.value = 'detecting'; started = false
  if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onFocus)
}
