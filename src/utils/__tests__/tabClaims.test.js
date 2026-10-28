import { describe, it, expect, vi, beforeEach } from 'vitest'

// Two "tabs" are two copies of the module sharing one BroadcastChannel bus.
const bus = new Set()
class FakeChannel {
  constructor() { this.listeners = new Set(); bus.add(this) }
  addEventListener(_, fn) { this.listeners.add(fn) }
  removeEventListener(_, fn) { this.listeners.delete(fn) }
  postMessage(data) { for (const ch of bus) if (ch !== this) setTimeout(() => ch.listeners.forEach((fn) => fn({ data })), 0) }
}

async function tab() {
  vi.resetModules()
  return import('../tabClaims.js')
}

describe('tab claims', () => {
  beforeEach(() => { bus.clear(); vi.stubGlobal('BroadcastChannel', FakeChannel) })

  it('sees a key another tab claimed, and not one it released', async () => {
    const a = await tab()
    const b = await tab()
    a.claim('workspace_1')
    expect(await b.isClaimedElsewhere('workspace_1', 20)).toBe(true)
    expect(await b.isClaimedElsewhere('workspace_2', 20)).toBe(false)
    a.release('workspace_1')
    expect(await b.isClaimedElsewhere('workspace_1', 20)).toBe(false)
  })

  it('does not count its own claim', async () => {
    const a = await tab()
    a.claim('workspace_1')
    expect(await a.isClaimedElsewhere('workspace_1', 20)).toBe(false)
  })
})
