import { describe, it, expect, vi, beforeEach } from 'vitest'

function stub(handler) {
  const calls = []
  vi.stubGlobal('chrome', { runtime: { lastError: null, sendMessage(msg, cb) {
    calls.push(`${msg.method} ${msg.url}`)
    Promise.resolve(handler(msg.url, msg)).then((data) => cb(data instanceof Error ? { error: data.message } : { data }))
  } } })
  return calls
}

describe('Run Query clean-up (feedback #30)', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('lists only SFMCQS_ data extensions and Query activities', async () => {
    stub((url) => {
      if (url.includes('customobjects/category/0')) return { count: 3, items: [
        { id: 'd1', name: 'SFMCQS_sql_20261019_1' }, { id: 'd2', name: 'My SFMCQS_ copy' }, { id: 'd3', name: 'SFMCQS_sql_20261018_2' }] }
      if (url.includes('/automation/v1/queries/')) return { count: 2, items: [
        { queryDefinitionId: 'q1', name: 'SFMCQS_act_20261019_1', targetName: 'SFMCQS_sql_20261019_1' }, { queryDefinitionId: 'q2', name: 'Daily load' }] }
      return {}
    })
    const { listToolkitDEs, listToolkitQueryActivities } = await import('../cleanup.js')
    expect((await listToolkitDEs('s13')).map((d) => d.id)).toEqual(['d1', 'd3'])
    expect(await listToolkitQueryActivities('s13')).toEqual([
      { id: 'q1', name: 'SFMCQS_act_20261019_1', targetName: 'SFMCQS_sql_20261019_1', createdDate: null, modifiedDate: null }])
  })

  it('deletes activities before data extensions and refuses other names', async () => {
    const calls = stub((url) => (url.includes('/bad') ? new Error('SFMC API error 500: nope') : {}))
    const { deleteToolkitObjects } = await import('../cleanup.js')
    const r = await deleteToolkitObjects('s13', {
      activities: [{ id: 'q1', name: 'SFMCQS_act_1' }],
      des: [{ id: 'd1', name: 'SFMCQS_sql_1' }, { id: 'd9', name: 'Customers' }, { id: 'bad', name: 'SFMCQS_sql_2' }],
    })
    expect(r.deleted.map((x) => x.id)).toEqual(['q1', 'd1'])
    expect(r.failed.map((f) => [f.item.id, f.error])).toEqual([['d9', 'Not created by Run Query: Customers'], ['bad', 'SFMC API error 500: nope']])
    const deletes = calls.filter((c) => c.startsWith('DELETE'))
    expect(deletes[0]).toMatch(/queries\/q1$/)
    expect(deletes.some((c) => c.includes('d9'))).toBe(false)
  })
})
