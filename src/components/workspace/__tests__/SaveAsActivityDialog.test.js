import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const created = []
vi.mock('../../../utils/sfmcApi.js', () => ({
  QUERY_UPDATE_TYPES: { 0: 'Overwrite', 1: 'Update', 2: 'Append' },
  listQAFolders: vi.fn(async () => ({ items: [{ categoryId: 5, parentId: 0, name: 'Query' }, { categoryId: 6, parentId: 5, name: 'Daily' }] })),
  listDERootFolders: vi.fn(async () => ({ entry: [{ id: '100', type: 'dataextension', name: 'Data Extensions' }, { id: '200', type: 'shared_data', name: 'Shared Items' }] })),
  listDEChildFolders: vi.fn(async () => ({ entry: [{ id: '101', type: 'dataextension', name: 'Reports' }] })),
  searchDEsAllSources: vi.fn(async () => ({ items: [] })),
  createTargetDE: vi.fn(async (s, p) => { created.push(['de', p]); return { id: 'D9', customerKey: 'K9' } }),
  createQueryActivity: vi.fn(async (s, p) => { created.push(['qa', p]); return { queryDefinitionId: 'Q9' } }),
}))
vi.mock('../../../utils/sfmcLinks.js', () => ({ openInSfmc: () => {} }))

const body = () => document.body.textContent
const button = (text) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

describe('Save as query activity dialog (feedback #88)', () => {
  afterEach(() => { document.body.innerHTML = ''; created.length = 0 })

  it('asks for folders, reviews, then creates the DE and the activity', async () => {
    const { default: Dialog } = await import('../SaveAsActivityDialog.vue')
    const w = mount(Dialog, {
      attachTo: document.body,
      props: { open: true, stack: 's13', sql: 'SELECT 1 AS One', defaultName: 'My query', resolveFields: async () => ({ fields: [{ name: 'One' }], activitySql: null }), cleanSql: (s) => s },
    })
    await flushPromises()
    expect(body()).toContain('Reports')
    // No DE folder yet: Review says so.
    button('Review').click()
    await flushPromises()
    expect(body()).toContain('Pick a folder for the new data extension.')
    ;[...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reports').click()
    await flushPromises()
    button('Review').click()
    await flushPromises()
    expect(body()).toContain('Nothing is run or scheduled')
    expect(body()).toContain('Data Extensions > Reports')
    button('Create in SFMC').click()
    await flushPromises()
    expect(created[0]).toEqual(['de', { name: 'My query', fields: [{ name: 'One' }], categoryID: 101 }])
    expect(created[1][1]).toMatchObject({ name: 'My query', categoryId: 5, targetId: 'D9', targetKey: 'K9', updateType: 0, queryText: 'SELECT 1 AS One' })
    expect(body()).toContain('Created.')
    w.unmount()
  // The first import compiles the dialog and its icons, which can pass 5 s on a busy machine.
  }, 20000)
})
