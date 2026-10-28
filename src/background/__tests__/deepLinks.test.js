import { describe, it, expect } from 'vitest'
import { lostDeepLink } from '../deepLinks.js'

const want = 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23Instance/d2xhVC1GR3FzRXFaNUV4dlNCY3B0QToyNTow'

describe('lostDeepLink (feedback #58)', () => {
  it('spots the shell without the item part', () => {
    expect(lostDeepLink(want, 'https://mc.s13.exacttarget.com/cloud/')).toBe(true)
    expect(lostDeepLink(want, 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/')).toBe(true)
    expect(lostDeepLink(want, 'https://mc.s13.exacttarget.com/cloud/#app/Automation Studio/AutomationStudioFuel3/#Instance/d2xhVC1GR3FzRXFaNUV4dlNCY3B0QToyNTow')).toBe(false)
    expect(lostDeepLink(want, want)).toBe(false)
  })
  it('leaves other pages alone (login, another stack)', () => {
    expect(lostDeepLink(want, 'https://mc.login.exacttarget.com/hub-cas/login')).toBe(false)
    expect(lostDeepLink(want, 'https://mc.s4.exacttarget.com/cloud/')).toBe(false)
  })
})
