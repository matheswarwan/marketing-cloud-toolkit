// From SFMC Automation Viewer's batchRunner.js.
// Runs `worker` over `items` in batches: the calls in one batch run in parallel,
// and the next batch starts only after every call in the current one has settled.
// Used by the Data Extension Finder's "View all fields" so a long result list
// doesn't fire hundreds of field requests at SFMC at once.
//
// onProgress(done, total) is called after each item settles. shouldStop() is
// checked before each batch; returning true ends the run early.
// Resolves to the settled results ({ status, value | reason }) in item order.
export async function runInBatches(items, batchSize, worker, { onProgress, shouldStop } = {}) {
  const results = []
  let done = 0
  for (let start = 0; start < items.length; start += batchSize) {
    if (shouldStop && shouldStop()) break
    const batch = items.slice(start, start + batchSize)
    const settled = await Promise.allSettled(batch.map(async (item, i) => {
      try {
        return await worker(item, start + i)
      } finally {
        done += 1
        if (onProgress) onProgress(done, items.length)
      }
    }))
    results.push(...settled)
  }
  return results
}
