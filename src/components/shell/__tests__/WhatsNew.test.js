import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

describe("What's New (feedback #1083)", () => {
  it('shows 3 items a page with Previous and Next, keeps the header fixed, closes on Esc', async () => {
    const store = { _seenVersion: '2.0.21' }
    globalThis.chrome = { storage: { local: { get: (k, cb) => cb({ ...store }), set: (o) => Object.assign(store, o) } } }
    const { default: WhatsNew } = await import('../WhatsNew.vue')
    const w = mount(WhatsNew, { attachTo: document.body })
    await flushPromises()
    expect(w.find('[data-whatsnew]').classes()).toContain('max-h-[calc(100vh-2rem)]')
    expect(w.find('#whatsnew-title').text()).toBe("What's new in Marketing Cloud Toolkit")
    expect(w.findAll('[data-whatsnew-item]')).toHaveLength(3)
    expect(w.text()).toContain('Remove contacts from a journey')
    expect(w.text()).not.toContain('Background jobs')
    expect(w.find('[data-whatsnew-page]').text()).toMatch(/^Page 1 of \d+$/)
    expect(w.find('[data-whatsnew-prev]').attributes('disabled')).toBeDefined()

    await w.find('[data-whatsnew-next]').trigger('click')
    expect(w.find('[data-whatsnew-page]').text()).toMatch(/^Page 2 of/)
    expect(w.text()).toContain('Background jobs')
    expect(w.text()).not.toContain('Remove contacts from a journey')
    // This version's 5 items fill pages 1 and 2; page 2 ends with the first earlier update.
    expect(w.findAll('[data-whatsnew-item]').at(2).text()).toMatch(/^Earlier update/)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await flushPromises()
    expect(w.find('[data-whatsnew-page]').text()).toMatch(/^Page 1 of/)

    const total = Number(w.find('[data-whatsnew-page]').text().match(/of (\d+)/)[1])
    for (let i = 0; i < total + 2; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(w.find('[data-whatsnew-page]').text()).toBe(`Page ${total} of ${total}`)
    expect(w.find('[data-whatsnew-next]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('No more empty searches')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('[data-whatsnew]').exists()).toBe(false)
    expect(store._seenVersion).not.toBe('2.0.21')
    w.unmount()
  })
})
