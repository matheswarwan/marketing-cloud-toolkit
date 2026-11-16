import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const calls = vi.hoisted(() => [])
vi.mock('@/utils/messagingApi.js', async (orig) => ({
  ...(await orig()),
  fetchJourneyEmailResults: async (s, j) => { calls.push(j.version); return [{ key: 'EMAILV2-1', name: 'Welcome', emailName: 'W', counts: { sent: 100, delivered: 98, opens: 49, clicks: 9, bounces: 2, optOuts: 1, notSentError: 3 } }, { key: 'EMAILV2-2', name: 'Day 3', counts: null }] },
}))

describe('Journey email results', () => {
  const journey = { id: 'J', version: 2, activities: [{ key: 'EMAILV2-1', type: 'EMAILV2', configurationArguments: { triggeredSendKey: '1' } }] }
  it('loads only when opened and shows rates against delivered', async () => {
    const { default: C } = await import('../JourneyEmailResults.vue')
    const w = mount(C, { props: { stack: 's10', journey } })
    expect(calls).toEqual([])
    await w.find('button').trigger('click')
    await flushPromises()
    expect(calls).toEqual([2])
    const row = w.find('[data-email-step="EMAILV2-1"]').text()
    expect(row).toContain('50%')
    expect(row).toContain('9.2%')
    expect(w.find('[data-email-step="EMAILV2-2"]').text()).toContain('No numbers yet')
  })
  it('is not shown for a journey without email steps', async () => {
    const { default: C } = await import('../JourneyEmailResults.vue')
    expect(mount(C, { props: { journey: { activities: [] } } }).find('[data-journey-email-results]').exists()).toBe(false)
  })
})
