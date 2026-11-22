import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

vi.mock('../QueryPanel.vue', () => ({
  default: defineComponent({
    props: ['queryId', 'isExpanded'],
    emits: ['expand'],
    setup(props, { emit }) {
      return () => h('button', { 'data-panel': props.queryId, 'data-expanded': String(props.isExpanded), onClick: () => emit('expand') })
    },
  }),
}))

const panels = [{ queryId: 'a' }, { queryId: 'b' }]

describe('Run Query full screen (feedback #1122)', () => {
  it('covers the window when a panel is expanded, and Escape leaves it', async () => {
    const { default: WorkspaceGrid } = await import('../WorkspaceGrid.vue')
    const w = mount(WorkspaceGrid, { props: { panels, layoutCols: 2, layoutRows: 1 }, attachTo: document.body })
    const root = () => w.find('.workspace-grid')
    expect(root().classes()).not.toContain('fixed')

    await w.find('[data-panel="a"]').trigger('click')
    expect(root().classes()).toContain('fixed')
    expect(root().classes()).toContain('inset-0')
    expect(root().attributes('data-full-screen')).toBe('')
    expect(w.find('[data-panel="a"]').attributes('data-expanded')).toBe('true')
    expect(w.find('[data-panel="b"]').classes()).toContain('hidden')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(root().classes()).not.toContain('fixed')
    expect(w.find('[data-panel="b"]').classes()).not.toContain('hidden')
    w.unmount()
  })

  it('keeps full screen when Escape closes an open dialog or menu first', async () => {
    const { default: WorkspaceGrid } = await import('../WorkspaceGrid.vue')
    const w = mount(WorkspaceGrid, { props: { panels, layoutCols: 2, layoutRows: 1 }, attachTo: document.body })
    await w.find('[data-panel="a"]').trigger('click')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.find('.workspace-grid').classes()).toContain('fixed')
    dialog.remove()
    w.unmount()
  })
})
