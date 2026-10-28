import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const calls = []
vi.mock('@/utils/sfmcApi.js', () => ({
  logInfo: () => {},
  sfmcFetch: vi.fn(async (url, method, body) => {
    calls.push([method, url, body])
    return method === 'GET' ? { queryDefinitionId: 'Q1ABC123', name: 'Daily', queryText: 'SELECT now', targetName: 'T', modifiedDate: 'x' } : {}
  }),
}))
vi.mock('@/components/results/CodeView.vue', () => ({ default: { props: ['code', 'lang'], template: '<pre class="code">{{ code }}</pre>' } }))

const KEY = 'activity_query_q1abc123'
const store = {
  [KEY]: {
    id: KEY, kind: 'query', activityId: 'Q1ABC123', name: 'Daily load', stack: 's13', businessUnit: { name: 'Main BU' },
    versions: [
      { versionId: 'v_3_s', savedAt: 3, source: 'saved', name: 'Daily load', content: 'SELECT a\nFROM t\nWHERE x = 2', targetName: 'T', stack: 's13' },
      { versionId: 'v_2_b', savedAt: 2, source: 'before-save', name: 'Daily load', content: 'SELECT a\nFROM t\nWHERE x = 1', targetName: 'T', stack: 's13' },
    ],
  },
  activity_script_s1abc123: { id: 'activity_script_s1abc123', kind: 'script', activityId: 'S1ABC123', name: 'Cleanup script', stack: 's13', versions: [{ versionId: 'v_1_s', savedAt: 1, content: 'Platform.Load("core","1")' }] },
  activity_script_validate: { id: 'activity_script_validate', kind: 'script', activityId: 'validate', name: 'validate', stack: 's13', versions: [{ versionId: 'v_0_s', savedAt: 0, content: 'x' }] },
  email_1: { assetId: 1 },
}
globalThis.chrome = {
  storage: {
    local: {
      get: (k, cb) => { const r = k === null ? store : { [k]: store[k] }; cb ? cb(r) : Promise.resolve(r) },
      set: (o, cb) => { Object.assign(store, o); cb?.() },
      remove: (k, cb) => { [].concat(k).forEach((x) => delete store[x]); cb?.() },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
}

async function mountAt(path) {
  const { default: Page } = await import('../SavedActivitiesPage.vue')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/saved-activities', component: Page },
      { path: '/saved-activities/:id', component: Page },
      { path: '/queries/workspace', component: { template: '<div />' } },
      { path: '/settings', component: { template: '<div />' } },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}
const button = (w, t) => w.findAll('button').find((b) => b.text().trim() === t)

describe('Saved Activities (feedback #122)', () => {
  it('lists saved activities newest first and filters them', async () => {
    const { w } = await mountAt('/saved-activities')
    const names = w.findAll('li').map((li) => li.text())
    expect(names[0]).toContain('Daily load')
    expect(names[0]).toContain('2 versions')
    expect(names[1]).toContain('Cleanup script')
    expect(names).toHaveLength(2)
    expect(store.activity_script_validate).toBeUndefined() // feedback #130
    await w.find('input[type="search"]').setValue('platform.load')
    expect(w.findAll('li')).toHaveLength(1)
    w.unmount()
  })

  it('shows a version, its changes, and restores it after a confirm step', async () => {
    const { w, router } = await mountAt(`/saved-activities/${KEY}`)
    expect(w.find('.code').text()).toContain('WHERE x = 2')
    await w.findAll('[role="tab"]').find((t) => t.text() === 'Changes').trigger('click')
    expect(w.text()).toContain('1 line differs')
    expect(w.find('[aria-label="Changes"]').text()).toContain('WHERE x = 1')
    // Pick v1 (the version before the edit) and restore it.
    await w.findAll('aside [aria-current]')[1].trigger('click')
    await button(w, 'Restore this version').trigger('click')
    expect(w.text()).toContain('Replace the SQL of "Daily load" in Automation Studio with v1?')
    await button(w, 'Restore').trigger('click')
    await flushPromises()
    const url = 'https://mc.s13.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/queries/Q1ABC123'
    expect(calls[0]).toEqual(['GET', url, undefined])
    expect(calls[1]).toEqual(['PATCH', url, { queryDefinitionId: 'Q1ABC123', name: 'Daily load', queryText: 'SELECT a\nFROM t\nWHERE x = 1', targetName: 'T' }])
    expect(w.text()).toContain('Restored in Automation Studio.')
    await button(w, 'Open in Run Query').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.sql).toBe('SELECT a\nFROM t\nWHERE x = 1')
    w.unmount()
  })
})
