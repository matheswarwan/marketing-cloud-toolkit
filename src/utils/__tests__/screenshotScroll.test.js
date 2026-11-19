// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { freezeScroll } from '../screenshot.js'

describe('freezeScroll (feedback #1108)', () => {
  it('shifts a scrolled area\'s children for the capture and puts everything back', () => {
    document.body.innerHTML = '<div id="app"><main id="m"><section id="c" style="transform: scale(1)"></section></main></div>'
    const m = document.getElementById('m')
    const c = document.getElementById('c')
    let top = 300
    Object.defineProperty(m, 'scrollTop', { get: () => top, set: (v) => { top = v }, configurable: true })
    const thaw = freezeScroll(document.getElementById('app'))
    expect(top).toBe(0)
    expect(c.style.transform).toBe('translate(0px, -300px) scale(1)')
    thaw()
    expect(top).toBe(300)
    expect(c.style.transform).toBe('scale(1)')
  })
})
