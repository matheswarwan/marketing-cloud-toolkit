import { describe, it, expect, vi } from 'vitest'

const calls = []
vi.mock('../sfmcApi.js', () => ({
  sfmcFetch: vi.fn(async (url) => {
    calls.push(url)
    if (url.includes('versionNumber')) {
      const e = new Error('Interaction matching criteria not found')
      e.status = 404
      throw e
    }
    return { id: 'j1', version: 34 }
  }),
}))

describe('fetchJourney (404 for the listed version)', () => {
  it('asks again without the version', async () => {
    const { fetchJourney } = await import('../journeys.js')
    await expect(fetchJourney('s50', 'j1', 33)).resolves.toMatchObject({ id: 'j1' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('versionNumber=33')
    expect(calls[1]).not.toContain('versionNumber')
  })
})
