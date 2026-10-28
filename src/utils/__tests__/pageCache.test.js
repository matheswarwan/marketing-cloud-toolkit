import { describe, it, expect, beforeEach } from 'vitest'
import { pageCacheKey, readPageCache, writePageCache, clearPageCache } from '../pageCache.js'
import { loadFeedbackContact, saveFeedbackContact, FEEDBACK_CONTACT_KEY } from '../feedbackContact.js'

describe('pageCache (feedback #66)', () => {
  beforeEach(() => clearPageCache())

  it('keys by page, stack and business unit', () => {
    expect(pageCacheKey('automation-overview', 's4', 123)).toBe('automation-overview:s4:123')
    expect(pageCacheKey('journey-overview', 's4', null)).toBe('journey-overview:s4:')
  })

  it('merges writes and stamps the time', () => {
    const k = pageCacheKey('automation-overview', 's4', 1)
    expect(readPageCache(k)).toBe(null)
    writePageCache(k, { list: [1, 2] }, 100)
    const e = writePageCache(k, { trends: { days: [] } }, 200)
    expect(e).toEqual({ list: [1, 2], trends: { days: [] }, savedAt: 200 })
    expect(readPageCache(pageCacheKey('automation-overview', 's4', 2))).toBe(null)
  })
})

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    async get(k) { return k in data ? { [k]: data[k] } : {} },
    async set(o) { Object.assign(data, o) },
    async remove(k) { delete data[k] },
  }
}

describe('feedback contact (feedback #65)', () => {
  it('is empty until something was sent', async () => {
    expect(await loadFeedbackContact(memoryStorage())).toEqual({ name: '', email: '' })
    expect(await loadFeedbackContact(undefined)).toEqual({ name: '', email: '' })
  })

  it('remembers the trimmed name and email, and forgets them when both are cleared', async () => {
    const s = memoryStorage()
    await saveFeedbackContact({ name: ' Ana ', email: 'ana@example.com ' }, s)
    expect(await loadFeedbackContact(s)).toEqual({ name: 'Ana', email: 'ana@example.com' })
    await saveFeedbackContact({ name: '', email: '' }, s)
    expect(FEEDBACK_CONTACT_KEY in s.data).toBe(false)
  })
})
