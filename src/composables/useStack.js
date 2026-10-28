import { ref, watch } from 'vue'
import { detectStack, readCachedStack, onStackChange } from '@/utils/stackDetection.js'

// The current SFMC stack, shared by every section. Starts from the cached stack
// (confirmed by the service worker), follows the stack picker and stacks the service
// worker drops after an auth failure.
const stack = ref(null)
const state = ref('detecting') // detecting | connected | disconnected
let started = false

async function detect() {
  const live = await detectStack().catch(() => null)
  if (live) { stack.value = live; state.value = 'connected' }
  else if (!stack.value) state.value = 'disconnected'
  return live
}

export function useStack() {
  if (!started) {
    started = true
    readCachedStack().then(({ stack: cached, isFresh }) => {
      if (isFresh && cached) { stack.value = cached; state.value = 'connected' }
      return detect()
    })
    onStackChange((s) => {
      if (s) { stack.value = s; state.value = 'connected' } else detect()
    })
  }
  return { stack, state, detect }
}

// Runs `fn` now if the stack is known, else once it is (searches opened from Ctrl+K
// in a fresh tab arrive before detection finishes). Gives up after 15 seconds.
export function whenStack(fn) {
  useStack()
  if (stack.value) return fn()
  const stop = watch(stack, (s) => { if (s) { stop(); clearTimeout(timer); fn() } })
  const timer = setTimeout(() => { stop(); if (!stack.value) fn() }, 15000)
}
