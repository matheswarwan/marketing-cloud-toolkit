import { describe, it, expect, vi, beforeEach } from 'vitest'

const counts = { '1': 120, '2': 5 }
let running = 0
let maxRunning = 0
vi.mock('../deApi.js', () => ({
  fetchDERowCount: vi.fn(async (stack, id) => {
    running++; maxRunning = Math.max(maxRunning, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    if (!(id in counts) && !id.startsWith('many')) throw new Error('404')
    return counts[id] ?? 1
  }),
}))
vi.mock('../sfmcApi.js', () => ({
  fetchCurrentBU: vi.fn(async () => ({ accountId: 77 })),
  fetchDEMetadata: vi.fn(async (stack, name) => (name === 'Exact DE' ? { id: '2', name: 'Exact DE' } : { id: '9', name: 'Exact DE copy' })),
}))

describe('rowCountFor (feedback #72)', () => {
  beforeEach(async () => { (await import('../deRowCounts.js')).clearRowCounts() })

  it('reads by id, and by exact name (ENT. stripped); a partial name match gives null', async () => {
    const { rowCountFor } = await import('../deRowCounts.js')
    expect(await rowCountFor('s13', { id: '1' })).toBe(120)
    expect(await rowCountFor('s13', { name: 'ENT.Exact DE' })).toBe(5)
    expect(await rowCountFor('s13', { name: 'Exact' })).toBeNull()
    expect(await rowCountFor('s13', { id: 'nope' })).toBeNull()
    expect(await rowCountFor(null, { id: '1' })).toBeNull()
  })

  it('caches counts and runs at most 10 requests at a time', async () => {
    const { rowCountFor } = await import('../deRowCounts.js')
    const { fetchDERowCount } = await import('../deApi.js')
    fetchDERowCount.mockClear()
    await Promise.all(Array.from({ length: 25 }, (_, i) => rowCountFor('s13', { id: `many${i}` })))
    expect(maxRunning).toBeLessThanOrEqual(10)
    expect(fetchDERowCount).toHaveBeenCalledTimes(25)
    await rowCountFor('s13', { id: 'many3' })
    expect(fetchDERowCount).toHaveBeenCalledTimes(25)
  })
})
