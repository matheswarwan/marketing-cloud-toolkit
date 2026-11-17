import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick } from 'vue'

// Detection answers what `live` says; the cached stack never changes (the case found live:
// logging in kept sfmcStack at 's10', so no storage event came).
let live = null
vi.mock('@/utils/stackDetection.js', () => ({
  detectStack: vi.fn(async () => live),
  readCachedStack: vi.fn(async () => ({ stack: 's10', isFresh: false })),
  onStackChange: vi.fn(),
}))

const { useStack, whenStack, resetStackForTests, RETRY_MS } = await import('../useStack.js')
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await nextTick() }

describe('useStack', () => {
  beforeEach(() => { vi.useFakeTimers(); live = null; resetStackForTests() })
  afterEach(() => { resetStackForTests(); vi.useRealTimers() })

  it('finds the stack after logging in, without a reload', async () => {
    const { stack, state } = useStack()
    await flush()
    expect(stack.value).toBe(null)
    expect(state.value).toBe('disconnected')
    live = 's10'
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await flush()
    expect(stack.value).toBe('s10')
    expect(state.value).toBe('connected')
  })

  it('looks again when the tab gets focus', async () => {
    const { stack } = useStack()
    await flush()
    live = 's10'
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(stack.value).toBe('s10')
  })

  it('stops looking once a stack is known', async () => {
    const { detectStack } = await import('@/utils/stackDetection.js')
    live = 's10'
    useStack()
    await flush()
    const calls = detectStack.mock.calls.length
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
    expect(detectStack.mock.calls.length).toBe(calls)
  })

  it('whenStack runs without a stack after 15 s, then again once one is found', async () => {
    const fn = vi.fn()
    whenStack(fn)
    await flush()
    expect(fn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15000)
    expect(fn).toHaveBeenCalledTimes(1)
    live = 's10'
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await flush()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('whenStack stops waiting when its page is left', async () => {
    const fn = vi.fn()
    const scope = effectScope()
    scope.run(() => whenStack(fn))
    await flush()
    scope.stop()
    live = 's10'
    await vi.advanceTimersByTimeAsync(20000)
    await flush()
    expect(fn).not.toHaveBeenCalled()
  })
})
