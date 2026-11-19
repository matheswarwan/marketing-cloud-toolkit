import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ContentFolderTree from '../ContentFolderTree.vue'

const LONG = 'AutomationMonitoring_Notifications_For_All_Business_Units'
const load = vi.fn(async (pid) => (pid === '0'
  ? [{ id: 'f1', name: LONG }, { id: 'f2', name: 'Synchronized Data Extensions' }]
  : pid === 'f2' ? [{ id: 'f3', name: 'Salesforce Contacts' }] : []))

async function tree(props = {}) {
  const w = mount(ContentFolderTree, { props: { stack: 's10', load, ...props } })
  await flushPromises()
  return w
}

describe('ContentFolderTree', () => {
  it('shows long folder names in full with a tooltip, in a box that scrolls sideways (#1118)', async () => {
    const w = await tree()
    const btn = w.get('[data-folder="f1"]')
    expect(btn.text()).toContain(LONG)
    expect(btn.attributes('title')).toBe(LONG)
    expect(btn.classes()).not.toContain('truncate')
    expect(btn.find('.truncate').exists()).toBe(false)
    expect(w.get('nav').classes()).toContain('overflow-auto')
    w.unmount()
  })

  it('lists the open folder\'s items after its sub-folders and emits item on click (#1119)', async () => {
    const items = [{ id: 'd1', name: 'Contact_Salesforce' }, { id: 'd2', name: 'Lead_Salesforce' }]
    const w = await tree({ modelValue: { id: 'f2', name: 'Synchronized Data Extensions' }, items, itemsFolder: 'f2', itemsTotal: 25 })
    await w.get('[data-folder="f2"]').trigger('click') // opening loads the sub-folders
    await flushPromises()
    const html = w.html()
    expect(html.indexOf('Salesforce Contacts')).toBeLessThan(html.indexOf('Contact_Salesforce'))
    expect(w.findAll('[data-folder-item]').map((b) => b.text())).toEqual(['Contact_Salesforce', 'Lead_Salesforce'])
    expect(w.get('[data-folder-more]').text()).toBe('23 more in the list')
    await w.get('[data-folder-item="d2"]').trigger('click')
    expect(w.emitted('item')[0][0]).toEqual(items[1])
    w.unmount()
  })

  it('never shows items listed for another folder', async () => {
    const w = await tree({ modelValue: { id: 'f2', name: 'x' }, items: [{ id: 'd1', name: 'Old' }], itemsFolder: 'f1' })
    await w.get('[data-folder="f2"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-folder-item]').exists()).toBe(false)
    w.unmount()
  })
})
