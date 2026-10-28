import { describe, it, expect } from 'vitest'
import { planJoin, joinInsertPoint } from '../joinInsert.js'
import { DATA_VIEW_FIELDS } from '../dataViews.js'

const dv = (n) => DATA_VIEW_FIELDS[n.toUpperCase()]
const apply = (sql, p) => sql.slice(0, p.at) + p.insert + sql.slice(p.at)

describe('Join to the query', () => {
  it('joins a data view on its known keys, before WHERE', async () => {
    const sql = 'SELECT s.SubscriberKey\nFROM _Sent s\nWHERE s.EventDate > GETDATE() - 7'
    const p = await planJoin(sql, { name: '_Job' }, dv('_Job'), (n) => dv(n))
    expect(apply(sql, p)).toBe('SELECT s.SubscriberKey\nFROM _Sent s\nLEFT JOIN _Job AS jo\n  ON s.JobID = jo.JobID\nWHERE s.EventDate > GETDATE() - 7')
    expect(p.matched).toBe(true)
  })
  it('joins a DE on a shared key at the end, or asks for the ON', async () => {
    const sql = 'SELECT * FROM [My DE] m'
    const p = await planJoin(sql, { name: '_Subscribers' }, dv('_Subscribers'), () => [{ name: 'SubscriberKey' }])
    expect(apply(sql, p)).toBe('SELECT * FROM [My DE] m\nLEFT JOIN _Subscribers AS su\n  ON m.SubscriberKey = su.SubscriberKey\n')
    const q = await planJoin(sql, { name: 'Other DE' }, [{ name: 'X' }], () => [{ name: 'Y' }])
    expect(q.insert).toContain('LEFT JOIN [Other DE] AS ot\n  ON /* set the join condition */')
    expect((await planJoin(sql, { name: 'My DE' }, [], () => [])).error).toMatch(/already/)
    expect(joinInsertPoint('SELECT 1')).toBe(null)
  })
})
