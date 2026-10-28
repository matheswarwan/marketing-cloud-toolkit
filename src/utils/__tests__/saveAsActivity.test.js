import { describe, it, expect } from 'vitest'
import { qaFolderOptions, checkSaveForm, saveAsQueryActivity } from '../saveAsActivity.js'

describe('Save as query activity (feedback #88)', () => {
  it('lists Query Activity folders as an indented tree', () => {
    const items = [
      { categoryId: 1, parentId: 0, name: 'Query' },
      { categoryId: 3, parentId: 1, name: 'Zeta' },
      { categoryId: 2, parentId: 1, name: 'Alpha' },
      { categoryId: 4, parentId: 2, name: 'Deep' },
    ]
    expect(qaFolderOptions(items).map((o) => `${o.depth}:${o.path}`)).toEqual(['0:Query', '1:Query > Alpha', '2:Query > Alpha > Deep', '1:Query > Zeta'])
  })

  it('says what is missing', () => {
    expect(checkSaveForm({})).toMatch(/name/)
    expect(checkSaveForm({ activityName: 'a', qaFolderId: 1, targetMode: 'new', deName: 'x', updateType: 0 })).toMatch(/folder for the new/)
    expect(checkSaveForm({ activityName: 'a', qaFolderId: 1, targetMode: 'existing', updateType: 0 })).toMatch(/Pick the data extension/)
    expect(checkSaveForm({ activityName: 'a', qaFolderId: 1, targetMode: 'existing', existingDE: { id: 'd' }, updateType: 2 })).toBe('')
  })

  it('creates a new DE with the resolved fields, then the activity with the wrapped SQL', async () => {
    const calls = []
    const api = {
      createTargetDE: async (s, p) => { calls.push(['de', p]); return { id: 'D1', customerKey: 'K1' } },
      createQueryActivity: async (s, p) => { calls.push(['qa', p]); return { queryDefinitionId: 'Q1', key: 'QK' } },
    }
    const r = await saveAsQueryActivity('s13', { activityName: ' Daily ', qaFolderId: 9, targetMode: 'new', deName: 'Out', deFolderId: '42', updateType: 2 }, {
      sql: 'SELECT _x FROM a', cleanSql: (s) => s.trim(), api,
      resolveFields: async () => ({ fields: [{ name: 't_x' }], activitySql: 'SELECT _x AS t_x FROM a' }),
    })
    expect(calls[0]).toEqual(['de', { name: 'Out', fields: [{ name: 't_x' }], categoryID: 42 }])
    expect(calls[1][1]).toMatchObject({ name: 'Daily', queryText: 'SELECT _x AS t_x FROM a', targetName: 'Out', targetKey: 'K1', targetId: 'D1', categoryId: 9, updateType: 2 })
    expect(r).toEqual({ de: { id: 'D1', key: 'K1', name: 'Out', created: true }, activity: { id: 'Q1', key: 'QK', name: 'Daily' } })
  })

  it('writes to an existing DE without creating one', async () => {
    const calls = []
    const api = { createTargetDE: async () => { throw new Error('no') }, createQueryActivity: async (s, p) => { calls.push(p); return { queryDefinitionId: 'Q2' } } }
    await saveAsQueryActivity('s13', { activityName: 'A', qaFolderId: 1, targetMode: 'existing', existingDE: { id: 'E', customerKey: 'EK', name: 'Existing' }, updateType: 0 }, {
      sql: ' SELECT 1 ', cleanSql: (s) => s.trim(), api, resolveFields: async () => { throw new Error('not used') },
    })
    expect(calls[0]).toMatchObject({ queryText: 'SELECT 1', targetName: 'Existing', targetKey: 'EK', targetId: 'E', updateType: 0 })
  })
})
