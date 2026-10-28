import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AppSidebar from '../AppSidebar.vue'

const opts = { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } }

describe('sidebar creator credit', () => {
  beforeEach(() => localStorage.clear())

  it('shows "Created by Matheswaran Kanagarajan, Ateko" with a LinkedIn link', () => {
    const w = mount(AppSidebar, opts)
    expect(w.text()).toContain('Created by Matheswaran Kanagarajan, Ateko')
    const a = w.find('a[href="https://www.linkedin.com/in/mathesk/"]')
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toBe('noopener noreferrer')
  })

  it('hides it while the sidebar is collapsed', async () => {
    const w = mount(AppSidebar, opts)
    await w.find('button[title="Collapse sidebar"]').trigger('click')
    expect(w.text()).not.toContain('Created by')
  })
})
