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
  // Contact Builder by ID (#1120): flat items, used first for Synchronized DEs.
  fetchDERowsById: vi.fn(async (stack, id, page, size) => {
    fetched.push({ id, page, size })
    if (fail) throw fail
    return { count: 3, pageSize: size, items: [{ subscriberkey: 's1', emailaddress: 'a@x.co' }, { subscriberkey: 's2', emailaddress: 'b@x.co' }, { subscriberkey: 's3', emailaddress: 'c@x.co' }] }
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

  // Feedback #1082: filtering from page 2 showed an empty table (35 of 497 rows matched).
  it('shows the matching rows when the filter is typed on a later page', async () => {
    fetched.length = 0
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    await button(w, 'Load 50k rows').trigger('click')
    await flushPromises()
    await w.find('button[title="Next page"]').trigger('click')
    expect(w.text()).toContain('2 / 2')
    await w.find('input[aria-label="Filter loaded rows"]').setValue('k7')
    expect(w.text()).toContain('of the 75 loaded rows match')
    const keys = w.findAll('tbody tr').map((r) => r.text()).filter((t) => /k7/.test(t))
    expect(keys.length).toBeGreaterThan(0)
  })

  it('loads all from where it is', async () => {
    fetched.length = 0
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    await button(w, 'Load 50k rows').trigger('click')
    await flushPromises()
    expect(fetched[1]).toEqual({ key: 'SUBS', page: 1, size: 2500 })
    expect(w.text()).toContain('75 of 75 rows loaded')
  })

  it('reads a Synchronized data extension through Contact Builder by ID (#1120)', async () => {
    fetched.length = 0
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: 'sync-1', name: 'Lead_Salesforce', customerKey: 'Lead_Salesforce', sourceType: 'sync' } } })
    await flushPromises()
    expect(fetched[0]).toEqual({ id: 'sync-1', page: 1, size: 50 })
    expect(fetched.some((f) => f.key)).toBe(false)
    expect(w.text()).toContain('3 of 3 rows')
    expect(w.text()).toContain('b@x.co')
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

describe('Preview data page and Load last N rows (feedback #1097)', () => {
  it('loads the last N rows from the known count, and First rows goes back', async () => {
    fetched.length = 0
    fail = null
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { props: { stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    await w.find('[data-de-rows-last] input').setValue(10)
    await w.find('[data-de-rows-last]').trigger('submit')
    await flushPromises()
    expect(fetched[1]).toEqual({ key: 'SUBS', page: 1, size: 2500 })
    expect(w.find('[data-de-rows-tail]').text()).toContain('Last 10 of 75 rows (rows 66 to 75)')
    const keys = w.findAll('tbody tr').map((r) => r.text())
    expect(keys.some((t) => t.includes('k74'))).toBe(true)
    expect(keys.some((t) => t.includes('k64'))).toBe(false)
    expect(button(w, 'Load 50 more')).toBeUndefined()
    await button(w, 'First rows').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('50 of 75 rows loaded')
  })

  it('draws as a page: Back instead of Close, Esc does not close, new tab link', async () => {
    const { default: Viewer } = await import('../DERowsViewer.vue')
    const w = mount(Viewer, { attachTo: document.body, props: { page: true, newTabHref: 'chrome-extension://x/app.html#/data-extensions/preview?key=SUBS', stack: 's13', de: { id: '1', name: 'Subs', customerKey: 'SUBS' } } })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.find('[aria-label="Close"]').exists()).toBe(false)
    expect(w.find('[data-de-rows-newtab]').attributes('target')).toBe('_blank')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeUndefined()
    await w.find('[data-de-rows-back]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})
