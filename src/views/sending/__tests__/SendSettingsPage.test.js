import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// Send settings (user, 2026-11-10) with IP addresses (feedback #1077).
vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s10') }), whenStack: (fn) => fn() }))
const state = vi.hoisted(() => ({ privateIps: [] }))
vi.mock('@/utils/setupApi.js', async (orig) => ({
  ...(await orig()),
  fetchSendSettings: async () => ({
    classifications: [{ id: 'c1', key: 'Default Commercial', name: 'Default Commercial', typeLabel: 'Commercial', type: 'Marketing', deliveryProfileKey: 'Default', profile: null, triggered: [], transactional: [], usedBy: 0, flags: [] }],
    profiles: [],
    triggeredSends: [],
    transactional: [],
    privateIps: state.privateIps,
    notes: [],
  }),
}))
const stubs = { DownloadMenu: true }

describe('Send settings page', () => {
  beforeEach(() => { state.privateIps = [] })

  it('says when the account has no private IP addresses', async () => {
    const { default: Page } = await import('../SendSettingsPage.vue')
    const w = mount(Page, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-send-settings-no-ips]').text()).toContain('no private (dedicated) IP addresses')
    expect(w.find('[data-send-settings-ips]').text()).toContain('cannot be read')
  })

  it('lists the private IP addresses', async () => {
    state.privateIps = [{ id: 1, name: 'Main', address: '13.111.0.1', active: true, order: 1 }]
    const { default: Page } = await import('../SendSettingsPage.vue')
    const w = mount(Page, { global: { stubs } })
    await flushPromises()
    const section = w.find('[data-send-settings-ips]')
    expect(section.text()).toContain('13.111.0.1')
    expect(section.text()).toContain('Main')
    expect(w.find('[data-send-settings-no-ips]').exists()).toBe(false)
  })

  it('leaves the section out of the table when SFMC refused the read', async () => {
    state.privateIps = null
    const { default: Page } = await import('../SendSettingsPage.vue')
    const w = mount(Page, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-send-settings-no-ips]').exists()).toBe(false)
    expect(w.find('[data-send-settings-ips] table').exists()).toBe(false)
  })
})
