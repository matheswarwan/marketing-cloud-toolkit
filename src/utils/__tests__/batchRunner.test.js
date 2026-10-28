// Ported from SFMC Automation Viewer's tests/batchRunner.test.js.
import { describe, it, expect } from 'vitest'
import { runInBatches } from '../batchRunner.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('runInBatches', () => {
  it('waits for every call in a batch before the next one, and reports failures', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    const pending = new Map()
    const started = []
    const progress = []
    const run = runInBatches(items, 10, (item) => {
      started.push(item)
      const d = deferred()
      pending.set(item, d)
      return d.promise
    }, { onProgress: (done, total) => progress.push(`${done}/${total}`) })

    await flush()
    expect(started).toHaveLength(10)
    for (let i = 0; i < 9; i++) pending.get(i).resolve(i)
    await flush()
    expect(started).toHaveLength(10)
    pending.get(9).reject(new Error('boom'))
    await flush()
    expect(started).toHaveLength(20)
    for (let i = 10; i < 20; i++) pending.get(i).resolve(i)
    await flush()
    expect(started).toHaveLength(25)
    for (let i = 20; i < 25; i++) pending.get(i).resolve(i)
    const results = await run
    expect(results).toHaveLength(25)
    expect(results[3].value).toBe(3)
    expect(results[9].status).toBe('rejected')
    expect(progress.at(-1)).toBe('25/25')
  })

  it('stops before the next batch when asked', async () => {
    let calls = 0
    let stop = false
    const results = await runInBatches([1, 2, 3, 4, 5], 2, async () => { calls += 1; if (calls === 2) stop = true }, { shouldStop: () => stop })
    expect(calls).toBe(2)
    expect(results).toHaveLength(2)
  })

  it('handles empty input', async () => {
    expect(await runInBatches([], 10, async () => 1)).toEqual([])
  })
})
