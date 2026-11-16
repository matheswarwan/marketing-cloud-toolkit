import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ path: '/queries/starter', query: {} }) }))
vi.mock('@/composables/useRouteSearch.js', () => ({ useRouteSearch: () => {} }))

describe('Starter queries page', () => {
  it('filters by words and category and opens a query in Run Query', async () => {
    const w = mount((await import('../StarterQueriesPage.vue')).default, { global: { stubs: { CodeView: true } } })
    const all = w.findAll('[data-starter]').length
    expect(all).toBeGreaterThan(15)
    await w.find('input').setValue('most common')
    expect(w.findAll('[data-starter]').map((a) => a.attributes('data-starter'))).toEqual(['bounce-reasons'])
    await w.find('[data-starter-open]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/queries/workspace', query: { sql: expect.stringContaining('FROM _Bounce') } })
    await w.find('input').setValue('')
    await w.findAll('button').find((b) => b.text() === 'Journeys').trigger('click')
    expect(w.findAll('[data-starter]').length).toBe(3)
  })
})
