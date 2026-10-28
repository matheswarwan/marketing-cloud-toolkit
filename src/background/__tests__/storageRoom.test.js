import { describe, it, expect } from 'vitest'
import { trimEmailVersions } from '../storageRoom.js'

const v = (at, size = 100) => ({ versionId: `v_${at}`, savedAt: at, body: 'x'.repeat(size) })

describe('trimEmailVersions', () => {
  const all = {
    sql_1: { id: 'sql_1', queryText: 'SELECT 1' },
    email_1: { id: 'email_1', versions: [v(50), v(10), v(5)] },
    email_2: { id: 'email_2', versions: [v(40), v(20)] },
    email_3: { id: 'email_3', versions: [v(30)] },
  }
  it('drops the oldest versions across emails first and keeps each newest one', () => {
    const { changed, freed } = trimEmailVersions(all, 150)
    expect(Object.keys(changed).sort()).toEqual(['email_1'])
    expect(changed.email_1.versions.map((x) => x.savedAt)).toEqual([50])
    expect(freed).toBeGreaterThanOrEqual(150)
  })
  it('never touches queries or an email with one version, even when more is needed', () => {
    const { changed } = trimEmailVersions(all, 1e9)
    expect(changed.sql_1).toBeUndefined()
    expect(changed.email_3).toBeUndefined()
    expect(changed.email_1.versions).toHaveLength(1)
    expect(changed.email_2.versions.map((x) => x.savedAt)).toEqual([40])
  })
  it('changes nothing when nothing is over', () => {
    expect(trimEmailVersions(all, 0).changed).toEqual({})
  })
})
