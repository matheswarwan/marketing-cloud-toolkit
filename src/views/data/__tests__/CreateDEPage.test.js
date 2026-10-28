import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const calls = []
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s13') }), whenStack: (fn) => fn() }))
vi.mock('@/utils/sfmcLinks.js', () => ({ openInSfmc: () => {} }))
vi.mock('@/utils/sfmcApi.js', async (orig) => ({
  ...(await orig()),
  fetchCurrentBU: vi.fn(async () => ({ accountId: 77 })),
  listDERootFolders: vi.fn(async () => ({ entry: [{ id: '100', type: 'dataextension', name: 'Data Extensions' }] })),
  listDEChildFolders: vi.fn(async () => ({ entry: [{ id: '101', type: 'dataextension', name: 'Imports' }] })),
  createDataExtension: vi.fn(async (s, body) => { calls.push(['create', body]); return { id: 'D1', customerKey: 'K1' } }),
  insertDERowsAsync: vi.fn(async (s, key, items) => { calls.push(['rows', key, items]) }),
}))

const store = {}
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } }

const text = (w) => w.text()
const button = (w, t) => w.findAll('button').find((b) => b.text().trim() === t)

describe('Create DE page (feedback #94)', () => {
  afterEach(() => { calls.length = 0 })

  it('reads a pasted sample, reviews, creates, adds rows and remembers the folder', async () => {
    const { default: Page } = await import('../CreateDEPage.vue')
    const w = mount(Page, { global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } } })
    await flushPromises()
    await w.find('textarea').setValue('Email;Age;Joined\na@b.co;31;2026-01-02\nc@d.co;;2026-02-03\n')
    await button(w, 'Read sample').trigger('click')
    await flushPromises()
    expect(text(w)).toContain('Read 2 row(s) and 3 column(s)')
    const types = w.findAll('select[aria-label$="type"]').map((s) => s.element.value)
    expect(types).toEqual(['EmailAddress', 'Number', 'Date'])
    expect(text(w)).not.toContain('do not fit')
    await w.find('input[aria-label="Field 2 required"]').setValue(true)
    expect(text(w)).toContain('1 value(s) in the sample do not fit')
    await w.find('input[aria-label="Data extension name"]').setValue('Signups')
    await button(w, 'Review').trigger('click')
    expect(text(w)).toContain('Pick a folder.')
    await w.findAll('button').find((b) => b.text().trim() === 'Imports').trigger('click')
    await w.find('select[aria-label="Data retention"]').setValue('rows')
    await button(w, 'Review').trigger('click')
    await flushPromises()
    expect(text(w)).toContain('Data Extensions > Imports')
    expect(text(w)).toContain('Delete individual records after 30 days')
    expect(text(w)).toContain('(1 with values that do not fit are left out)')
    await button(w, 'Create in SFMC').trigger('click')
    await flushPromises()
    const body = calls[0][1]
    expect(body).toMatchObject({ name: 'Signups', categoryID: 101, dataRetentionProperties: { isRowBasedRetention: true, dataRetentionPeriodLength: 30 } })
    expect(body.fields.map((f) => f.name)).toEqual(['Email', 'Age', 'Joined'])
    expect(calls[1]).toEqual(['rows', 'K1', [{ Email: 'a@b.co', Age: '31', Joined: '2026-01-02' }]])
    expect(text(w)).toContain('Created Signups')
    expect(store.toolkit_createDE_folders).toEqual({ 's13:77': { id: '101', path: 'Data Extensions > Imports' } })
    w.unmount()
  }, 20000)

  it('starts without a sample and uses the remembered folder', async () => {
    store.toolkit_createDE_folders = { 's13:77': { id: '101', path: 'Data Extensions > Imports' } }
    const { default: Page } = await import('../CreateDEPage.vue')
    const w = mount(Page, { global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } } })
    await flushPromises()
    await w.findAll('input[type="radio"]').find((r) => r.element.value === 'none').setValue(true)
    await button(w, 'Start with one field').trigger('click')
    await flushPromises()
    expect(text(w)).toContain('Data Extensions > Imports')
    await w.find('input[aria-label="Field 1 name"]').setValue('_bad')
    expect(text(w)).toContain('kept for SFMC')
    await w.find('input[aria-label="Field 1 name"]').setValue('Code')
    await w.find('input[aria-label="Data extension name"]').setValue('Codes')
    await button(w, 'Review').trigger('click')
    await button(w, 'Create in SFMC').trigger('click')
    await flushPromises()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ name: 'Codes', categoryID: 101 })
    w.unmount()
  })
})
