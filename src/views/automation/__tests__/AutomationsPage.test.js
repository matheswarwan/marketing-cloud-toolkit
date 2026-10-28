import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const APP = { id: 'automationStudio', name: 'Automation Studio', url: 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/' }
const noSession = () => Object.assign(new Error('Automation Studio sent a web page (its login) instead of data, so it has no session.'), { code: 'SFMC_SESSION_UNAVAILABLE', app: APP })
const search = vi.fn()
const sent = []
let connectReply = { ok: true }

vi.mock('@/composables/useStack.js', () => ({ useStack: () => ({ stack: ref('s13') }), whenStack: () => {} }))
vi.mock('@/composables/useRouteSearch.js', () => ({ useRouteSearch: () => {} }))
vi.mock('@/utils/automationApi.js', () => ({ searchAutomations: (...a) => search(...a), loadMoreAutomations: vi.fn() }))
vi.mock('@/utils/messaging.js', () => ({ sendToBackground: async (m) => { sent.push(m); return connectReply } }))
vi.mock('@/utils/sfmcLinks.js', () => ({ openInSfmc: () => {} }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push() {} }) }))

const mountPage = async () => {
  const { default: Page } = await import('../AutomationsPage.vue')
  return mount(Page, { global: { stubs: { WatchButton: true, DownloadMenu: true } } })
}
const button = (w, t) => w.findAll('button').find((b) => b.text().trim() === t)

describe('Automations search without a session (feedback #93)', () => {
  beforeEach(() => { search.mockReset(); sent.length = 0; connectReply = { ok: true } })

  it('starts the Automation Studio session and searches again', async () => {
    search.mockRejectedValueOnce(noSession()).mockResolvedValueOnce({ entries: [{ id: 'a1', name: 'Nightly', status: 'Scheduled' }], total: 1 })
    const w = await mountPage()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(sent).toEqual([{ type: 'SFMC_CONNECT_APP', stack: 's13', appId: 'automationStudio' }])
    expect(w.text()).toContain('Nightly')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('says it could not connect, with Retry and a link to log in, instead of an empty list', async () => {
    search.mockRejectedValue(noSession())
    connectReply = { error: 'Could not start a Automation Studio session on stack s13.', code: 'SFMC_SESSION_UNAVAILABLE' }
    const w = await mountPage()
    await w.find('form').trigger('submit')
    await flushPromises()
    const alert = w.find('[role="alert"]')
    expect(alert.text()).toContain('Could not connect to Automation Studio: Could not start a Automation Studio session on stack s13.')
    expect(alert.find('a').attributes('href')).toBe(APP.url)
    search.mockReset()
    search.mockResolvedValueOnce({ entries: [], total: 0 })
    await button(w, 'Retry').trigger('click')
    await flushPromises()
    expect(search).toHaveBeenCalledTimes(1)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
