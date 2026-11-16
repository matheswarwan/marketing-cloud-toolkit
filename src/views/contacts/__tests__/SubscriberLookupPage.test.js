import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// Subscriber lookup (user, 2026-11-10): cards load on their own and a failing card does not stop the others.
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s10') }), whenStack: (fn) => fn() }))
vi.mock('@/composables/useRouteSearch.js', () => ({ useRouteSearch: () => {} }))
vi.mock('@/utils/setupApi.js', () => ({ fetchBusinessUnits: async () => [{ mid: 100, name: 'Enterprise' }, { mid: 200, name: 'Retail' }] }))
const calls = []
let listsFail = false
vi.mock('@/utils/contactsLookup.js', async (orig) => ({
  ...(await orig()),
  fetchSubscribers: async (s, q) => {
    calls.push(['sub', q])
    if (q.email) return [{ id: 1, key: 'A', email: q.email, status: 'Active' }, { id: 2, key: 'B', email: q.email, status: 'Unsubscribed', unsubscribedDate: '2026-03-04T00:00:00' }]
    return q.key === 'nobody' ? [] : [{ id: 3, key: q.key, email: 'pat@example.com', status: 'Held', createdDate: '', unsubscribedDate: '', emailType: 'HTML' }]
  },
  fetchListMemberships: async (s, key) => {
    calls.push(['lists', key])
    if (listsFail) throw new Error('SFMC API error 500: boom')
    return [{ listId: 5, listName: 'Newsletter', status: 'Unsubscribed', createdDate: '', unsubscribedDate: '' }]
  },
  fetchBounces: async (s, key) => { calls.push(['bounces', key]); return [] },
  fetchUnsubscribes: async (s, key) => { calls.push(['unsubs', key]); return [] },
  fetchSubscriberAcrossBUs: async (s, q) => {
    calls.push(['allBUs', q.key || q.email, [...q.buNames.values()]])
    return [{ mid: 100, businessUnit: 'Enterprise', key: q.key, email: 'pat@example.com', status: 'Active' }, { mid: 200, businessUnit: 'Retail', key: q.key, email: 'pat@example.com', status: 'Unsubscribed' }]
  },
  fetchRecentSends: async (s, key) => { calls.push(['sends', key]); return { total: 1, rows: [{ sendId: 42, eventDate: '2026-11-01T00:00:00', triggeredSendId: '' }] } },
}))

const mountPage = async () => {
  const { default: Page } = await import('../SubscriberLookupPage.vue')
  return mount(Page, { global: { stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } } } })
}

describe('Subscriber lookup page', () => {
  beforeEach(() => { calls.length = 0; listsFail = false })

  it('looks up a key, explains why, and links each JobID to the Sends page', async () => {
    const w = await mountPage()
    await w.find('[data-sub-text]').setValue('K1')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(calls.map((c) => c[0]).sort()).toEqual(['bounces', 'lists', 'sends', 'sub', 'unsubs'])
    const why = w.find('[data-sub-why]').text()
    expect(why).toContain('Held at All Subscribers')
    expect(why).toContain('the list Newsletter')
    const link = w.find('[data-sub-card="sends"] a')
    expect(JSON.parse(link.attributes('data-to'))).toEqual({ path: '/sends', query: { q: '42' } })
  })

  it('checks every business unit only when asked, with the BU names (user, 2026-11-16)', async () => {
    const w = await mountPage()
    await w.find('[data-sub-text]').setValue('K1')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(calls.some((c) => c[0] === 'allBUs')).toBe(false)
    await w.find('[data-sub-all-bus]').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c[0] === 'allBUs')).toEqual(['allBUs', 'K1', ['Enterprise', 'Retail']])
    const card = w.find('[data-sub-card="allBUs"]').text()
    expect(card).toContain('Retail')
    expect(card).toContain('Active in 1, Unsubscribed in 1')
  })

  it('shows a card error without hiding the other cards', async () => {
    listsFail = true
    const w = await mountPage()
    await w.find('[data-sub-text]').setValue('K1')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[data-sub-card="lists"]').text()).toMatch(/500|boom|could not/i)
    expect(w.find('[data-sub-card="sends"]').text()).toContain('42')
    expect(w.find('[data-sub-card="subscriber"]').text()).toContain('pat@example.com')
  })

  it('by email address: several subscribers can be picked one by one', async () => {
    const w = await mountPage()
    await w.find('[data-sub-text]').setValue('pat@example.com')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(calls.find((c) => c[0] === 'sub')[1]).toEqual({ email: 'pat@example.com' })
    expect(calls.filter((c) => c[0] === 'lists').map((c) => c[1])).toEqual(['A'])
    const b = w.findAll('[data-sub-card="subscriber"] button').find((x) => x.text().startsWith('B'))
    await b.trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c[0] === 'lists').map((c) => c[1])).toEqual(['A', 'B'])
    expect(w.find('[data-sub-why]').text()).toContain('Unsubscribed at All Subscribers since 2026-03-04')
  })

  it('says when the key is not at All Subscribers', async () => {
    const w = await mountPage()
    await w.find('[data-sub-text]').setValue('nobody')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[data-sub-why]').text()).toContain('Not found at All Subscribers')
  })
})
