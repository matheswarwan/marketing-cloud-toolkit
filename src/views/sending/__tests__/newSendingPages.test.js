import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s10') }), whenStack: (fn) => fn() }))
vi.mock('@/composables/useRouteSearch.js', () => ({ useRouteSearch: () => {} }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ path: '/', query: {} }) }))
const feeds = vi.hoisted(() => ({ bouncesFail: false }))
vi.mock('@/utils/sendEvents.js', async (orig) => ({
  ...(await orig()),
  fetchBounceFeed: async () => { if (feeds.bouncesFail) throw new Error('SFMC SOAP: Error boom'); return { rows: [{ sendId: 9, subscriberKey: 'a', eventDate: '2026-11-15T10:00:00', category: 'Hard bounce', type: '', smtpCode: '550', smtpReason: 'No such user' }], capped: true } },
  fetchNotSentFeed: async () => ({ rows: [{ sendId: 9, subscriberKey: 'b', eventDate: '2026-11-15T10:00:00', eventType: 'Unsubscribed' }], capped: false }),
  fetchEngagementFeed: async (s, kind) => ({ rows: kind === 'unsubscribes' ? [{ sendId: 7, subscriberKey: 'u1', eventDate: '2026-11-14T10:00:00', master: true }, { sendId: 7, subscriberKey: 'u2', eventDate: '2026-11-15T10:00:00', master: false }] : [], capped: false }),
  fetchSendDetails: async () => ({ lists: { rows: [{ listId: 414, listName: 'All Subscribers', sent: 1 }] }, notSent: { error: 'refused' }, notSentByType: null, unsubscribes: { rows: [] } }),
}))
vi.mock('@/utils/messagingApi.js', async (orig) => ({
  ...(await orig()),
  fetchTriggeredSends: async () => [{ key: 'k1', name: 'Welcome', status: 'Active', queued: 3, notSentError: 0 }, { key: 'k2', name: 'Fine', status: 'Active', queued: 0, notSentError: 0 }],
  fetchSends: async () => [{ jobId: 441901, emailName: 'Hello', sent: 1, delivered: 1 }],
}))
vi.mock('@/utils/setupApi.js', async (orig) => ({ ...(await orig()), fetchImportResults: async () => [{ name: 'Load', status: 'Completed', errors: 2, start: '' }, { name: 'Ok', status: 'Completed', errors: 0, start: '' }] }))
const stubs = { DownloadMenu: true, StatusBadge: true, RouterLink: { props: ['to'], template: '<a :data-to="String(to)"><slot /></a>' } }

describe('Send problems page', () => {
  it('shows each card on its own, with counts, groups and the capped note', async () => {
    const w = mount((await import('../SendProblemsPage.vue')).default, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-tile="bounces"]').text()).toContain('1+')
    expect(w.find('[data-tile="triggered"]').text()).toContain('1')
    expect(w.find('[data-tile="imports"]').text()).toContain('1')
    const t = w.text()
    expect(t).toContain('No such user')
    expect(t).toContain('More bounces than shown: only the newest 1 were read')
    expect(t).toContain('Unsubscribed: 1')
    expect(t).toContain('3 queued')
    expect(t).toContain('2 errors')
    expect(w.find('a[data-to="/sends?q=9"]').exists()).toBe(true)
  })
  it('a failing card does not hide the others', async () => {
    feeds.bouncesFail = true
    const w = mount((await import('../SendProblemsPage.vue')).default, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-tile="bounces"]').text()).toContain('?')
    expect(w.text()).toContain('Unsubscribed: 1')
    feeds.bouncesFail = false
  })
})

describe('Engagement events page', () => {
  it('counts each feed and lists unsubscribes with their scope', async () => {
    const w = mount((await import('../EngagementEventsPage.vue')).default, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-feed-tab="unsubscribes"]').text()).toContain('2')
    expect(w.find('[data-feed-tab="sms"]').text()).toContain('0')
    expect(w.text()).toContain('Everything')
    expect(w.find('[data-per-day]').exists()).toBe(true)
    await w.find('[data-feed-tab="sms"]').trigger('click')
    expect(w.text()).toContain('the phone number is in MobileConnect')
  })
})

describe('Sends page details', () => {
  it('opens the details of a send, with a refused part said in place', async () => {
    const w = mount((await import('../SendsPage.vue')).default, { global: { stubs } })
    await flushPromises()
    await w.find('[data-send-details-open="441901"]').trigger('click')
    await flushPromises()
    const d = w.find('[data-send-details]').text()
    expect(d).toContain('All Subscribers')
    expect(d).toContain('refused')
    expect(d).toContain('Nobody unsubscribed')
  })
})
