import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, reactive } from 'vue'

vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/where-used', query: {} }), useRouter: () => ({ push() {}, replace() {} }) }))
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s10') }), whenStack: (fn) => fn() }))
vi.mock('@/composables/useUsage.js', () => ({
  useUsage: () => ({ state: reactive({ open: false, target: null, running: false }), start: vi.fn() }),
  targetKey: (t) => (t ? `${t.kind}:${t.de?.id ?? ''}:${t.field || ''}` : ''),
}))
vi.mock('@/utils/deApi.js', async (orig) => ({
  ...(await orig()),
  searchLocalDEs: async () => ({
    items: Array.from({ length: 40 }, (_, i) => ({ id: `de-${i}`, name: `Synthetic DE ${i}`, customerKey: `KEY_${i}`, modifiedDate: '2026-11-01T00:00:00Z' })),
  }),
  searchSharedSyncDEs: async () => [],
  fetchDEFieldList: async () => Array.from({ length: 30 }, (_, i) => ({ name: `Field${i}`, fieldType: 'Text' })),
}))

async function searchFor(kind) {
  const { default: Page } = await import('../WhereUsedPage.vue')
  const w = mount(Page)
  await w.find('#wu-kind').setValue(kind)
  await w.find('form').trigger('submit')
  await flushPromises()
  return w
}

describe('Where used page layout', () => {
  it('keeps the search results list at full height so its column can scroll', async () => {
    const w = await searchFor('de')
    expect(w.text()).toContain('Synthetic DE 39')
    const list = w.findAll('section').find((s) => s.text().includes('Synthetic DE 0'))
    expect(list.classes()).toContain('shrink-0')
    expect(list.element.parentElement.className).toMatch(/lg:overflow-y-auto/)
  }, 30000)

  it('keeps the field list at full height so its column can scroll', async () => {
    const w = await searchFor('field')
    await w.findAll('button').find((b) => b.text().includes('Pick a field')).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Field29')
    const list = w.findAll('section').find((s) => s.text().includes('Field0'))
    expect(list.classes()).toContain('shrink-0')
    expect(list.element.parentElement.className).toMatch(/lg:overflow-y-auto/)
  }, 30000)
})
