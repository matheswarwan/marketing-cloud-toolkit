import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// Contact deletions (user, 2026-11-10): no operations is a calm note, a 403 summary a blue note.
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s10') }), whenStack: (fn) => fn() }))
let ops = []
let summaryResult = { notAuthorized: true }
vi.mock('@/utils/contactsLookup.js', async (orig) => ({
  ...(await orig()),
  fetchAllDeleteOperations: async () => ({ count: ops.length, items: ops }),
  fetchDeleteSummary: async () => summaryResult,
}))

const mountPage = async () => {
  const { default: Page } = await import('../ContactDeletionsPage.vue')
  return mount(Page, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
}

describe('Contact deletions page', () => {
  beforeEach(() => { ops = []; summaryResult = { notAuthorized: true } })

  it('says none were found and shows the missing permission as a note, not an error', async () => {
    const w = await mountPage()
    await flushPromises()
    expect(w.find('[data-deletions-empty]').text()).toContain('No contact deletions were found')
    expect(w.find('[data-deletions-no-access]').exists()).toBe(true)
    expect(w.text()).not.toMatch(/SFMC API error/)
  })

  it('lists operations with their fields, the summary as numbers, and all fields on demand', async () => {
    ops = [{ operationID: 77, operationName: 'Old leads', status: 'Completed', deleteType: 'ContactAndAttributes', actualListCount: 4, successCount: 3, deletedCount: 3 }]
    summaryResult = { summary: { totaltimeseries: [{ requestcount: 6 }], statustimeseries: [{ status: 'Completed', requestcount: 6 }] } }
    const w = await mountPage()
    await flushPromises()
    expect(w.text()).toContain('1 operation')
    expect(w.text()).toContain('77')
    expect(w.text()).toContain('Old leads')
    expect(w.text()).toContain('Contacts and their data')
    expect(w.find('[data-deletions-totals]').text()).toContain('6')
    expect(w.text()).not.toMatch(/not confirmed/)
    expect(w.find('[data-deletions-no-access]').exists()).toBe(false)
    const raw = w.findAll('button').find((b) => b.text() === 'All fields')
    await raw.trigger('click')
    expect(w.text()).toContain('"deletedCount": 3')
  })
})
