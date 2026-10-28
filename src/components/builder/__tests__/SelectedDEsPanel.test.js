import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../../../utils/sfmcApi.js', () => ({ fetchDEFieldsCached: vi.fn(async () => { throw new Error('not a DE') }) }))

describe('Query Builder joins of data views (feedback #52)', () => {
  it('fills _Click LEFT JOIN _Job ON JobID even when _Job was not flagged as a data view', async () => {
    const { default: SelectedDEsPanel } = await import('../SelectedDEsPanel.vue')
    const w = mount(SelectedDEsPanel, {
      props: { stack: 's4', selected: [], 'onUpdate:selected': (v) => w.setProps({ selected: v }) },
      shallow: true,
    })
    await w.vm.addDe({ id: 'dv-click', name: '_Click', isDataView: true })
    await w.vm.addDe({ id: 'x-job', name: '_Job' })
    await flushPromises()
    const emitted = w.emitted('update:joins')
    const last = emitted[emitted.length - 1][0]
    expect(last[0].conditions).toEqual([{ leftField: 'JobID', operator: '=', rightField: 'JobID' }])
  })
})
