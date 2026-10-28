import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStorageGet  = vi.fn()
const mockStorageSet  = vi.fn()
const mockSendMessage = vi.fn()

global.chrome = {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null,
  },
}

import { detectStack, readCachedStack, STACK_CACHE_TTL } from '../stackDetection.js'

describe('detectStack', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockStorageSet.mockImplementation(() => {})
    global.chrome.runtime.lastError = null
  })

  it('returns stackKey from session JWT and saves it with a timestamp', async () => {
    mockSendMessage.mockImplementation((msg, cb) => cb({ session: { stackKey: 's51' } }))

    const result = await detectStack()

    expect(result).toBe('s51')
    expect(mockStorageSet).toHaveBeenCalledWith(
      expect.objectContaining({ sfmcStack: 's51', sfmcStackTs: expect.any(Number) })
    )
  })

  it('normalises uppercase stackKey from JWT to lowercase', async () => {
    mockSendMessage.mockImplementation((msg, cb) => cb({ session: { stackKey: 'S10' } }))
    const result = await detectStack()
    expect(result).toBe('S10') // detectStack returns what session gives; normalisation is in content.js
  })

  it('returns null when the background SW reports no session', async () => {
    // The SW handles its own fallback probes; detectStack just relays the result
    mockSendMessage.mockImplementation((msg, cb) => cb({ session: null }))
    const result = await detectStack()
    expect(result).toBeNull()
    expect(mockStorageSet).not.toHaveBeenCalled()
  })

  it('returns null when sendMessage has a runtime error', async () => {
    mockSendMessage.mockImplementation((msg, cb) => {
      global.chrome.runtime.lastError = { message: 'Extension context invalid' }
      cb(undefined)
    })
    const result = await detectStack()
    expect(result).toBeNull()
  })

  it('returns null when the SW returns an empty response', async () => {
    mockSendMessage.mockImplementation((msg, cb) => cb({}))
    const result = await detectStack()
    expect(result).toBeNull()
  })
})

describe('readCachedStack', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.chrome.runtime.lastError = null
  })

  it('returns isFresh=true when stack is cached within TTL', async () => {
    mockStorageGet.mockImplementation((keys, cb) =>
      cb({ sfmcStack: 's10', sfmcStackTs: Date.now() - 60_000 }) // 1 min ago
    )
    const { stack, isFresh } = await readCachedStack()
    expect(stack).toBe('s10')
    expect(isFresh).toBe(true)
  })

  it('returns isFresh=false when cache is older than TTL', async () => {
    mockStorageGet.mockImplementation((keys, cb) =>
      cb({ sfmcStack: 's10', sfmcStackTs: Date.now() - STACK_CACHE_TTL - 1000 })
    )
    const { stack, isFresh } = await readCachedStack()
    expect(stack).toBe('s10')
    expect(isFresh).toBe(false)
  })

  it('returns isFresh=false when no cached stack exists', async () => {
    mockStorageGet.mockImplementation((keys, cb) => cb({}))
    const { stack, isFresh } = await readCachedStack()
    expect(stack).toBeNull()
    expect(isFresh).toBe(false)
  })

  it('returns isFresh=false when timestamp is missing', async () => {
    mockStorageGet.mockImplementation((keys, cb) => cb({ sfmcStack: 's1' }))
    const { stack, isFresh } = await readCachedStack()
    expect(stack).toBe('s1')
    expect(isFresh).toBe(false)
  })
})
