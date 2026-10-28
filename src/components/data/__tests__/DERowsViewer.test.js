import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const fetched = []
let fail = null
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s13') }), whenStack: (fn) => fn() }))
vi.mock('@/utils/sfmcLinks.js', () => ({ openInSfmc: () => {} }))
vi.mock('@/utils/deApi.js', () => ({ fetchDEFieldList: vi.fn(async () => [{ name: 'SubscriberKey' }, { name: 'EmailAddress' }]) }))
vi.mock('@/utils/sfmcApi.js', () => ({
  fetchDERows: vi.fn(async (stack, key, page, size) => {
    fetched.push({ key, page, size })
    if (fail) throw fail
    const n = 75
    const start = (page - 1) * size
    return { count: n, items: Array.from({ length: Math.max(0, Math.min(size, n - start)) }, (_, i) => ({ keys: { subscriberkey: `k${start + i}` }, values: { emailaddress: i % 2 ? 'odd@x.co' : 'even@x.co' } })) }
  }),
}))

const button = (w, t) => w.findAll('button').find((b) => b.text().trim().startsWith(t))

describe('DE rows viewer (feedback #117)', () => {
  it('reads 50, loads more, filters and hides columns', async () => {
    fetched.length = 0
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    expect(fetched[0]).toEqual({ key: 'SUBS', page: 1, size: 50 })
    expect(w.text()).toContain('50 of 75 rows loaded')
    expect(w.findAll('th').map((t) => t.text()).filter(Boolean)).toEqual(['SubscriberKey', 'EmailAddress'])
    await button(w, 'Load 50 more').trigger('click')
    await flushPromises()
    expect(fetched[1]).toEqual({ key: 'SUBS', page: 2, size: 50 })
    expect(w.text()).toContain('75 of 75 rows loaded')
    expect(button(w, 'Load 50 more')).toBeUndefined()
    await w.find('input[aria-label="Filter loaded rows"]').setValue('k7')
    expect(w.text()).toContain('of the 75 loaded rows match')
    await button(w, 'Columns').trigger('click')
    await w.findAll('input[type="checkbox"]')[1].setValue(false)
    expect(w.findAll('th').map((t) => t.text()).filter(Boolean)).toEqual(['SubscriberKey'])
  })

  it('loads all from where it is', async () => {
    fetched.length = 0
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    await button(w, 'Load all').trigger('click')
    await flushPromises()
    expect(fetched[1]).toEqual({ key: 'SUBS', page: 1, size: 2500 })
    expect(w.text()).toContain('75 of 75 rows loaded')
  })

  it('says why a Shared data extension could not be read', async () => {
    fail = Object.assign(new Error('SFMC API error 404: not found'), { status: 404 })
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '2', name: 'Ent', customerKey: 'ENT1', sourceType: 'shared' } } })
    await flushPromises()
    expect(w.text()).toContain('Could not read the rows: SFMC API error 404')
    expect(w.text()).toContain('Shared data extensions may only be readable from the business unit that owns them')
    fail = null
  })
})
