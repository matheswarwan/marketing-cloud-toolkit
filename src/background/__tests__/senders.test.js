import { describe, it, expect } from 'vitest'
import { messageAllowed } from '../senders.js'

const EXT = 'chrome-extension://abc/'
const page = { url: `${EXT}app.html` }
const sfmcTab = { url: 'https://mc.s7.exacttarget.com/cloud/#app/Automation%20Studio', tab: { id: 3 } }
const auto = 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/automation/v1/automations/9f0c-11'

describe('message senders', () => {
  it('lets the extension pages send anything', () => {
    expect(messageAllowed({ type: 'SAVE_RECORDS' }, page, EXT)).toBe(true)
    expect(messageAllowed({ type: 'SFMC_FETCH', url: 'https://mc.s7.exacttarget.com/x', method: 'POST', body: {} }, page, EXT)).toBe(true)
  })
  it('lets content scripts send only their own messages', () => {
    expect(messageAllowed({ type: 'SFMC_CONTEXT_CAPTURED' }, sfmcTab, EXT)).toBe(true)
    expect(messageAllowed({ type: 'OPEN_APP' }, sfmcTab, EXT)).toBe(true)
    expect(messageAllowed({ type: 'SAVE_RECORDS' }, sfmcTab, EXT)).toBe(false)
    expect(messageAllowed({ type: 'SET_STACK_OVERRIDE' }, sfmcTab, EXT)).toBe(false)
  })
  it('lets content scripts fetch only a GET of one automation', () => {
    expect(messageAllowed({ type: 'SFMC_FETCH', url: auto, method: 'GET' }, sfmcTab, EXT)).toBe(true)
    expect(messageAllowed({ type: 'SFMC_FETCH', url: auto, method: 'DELETE' }, sfmcTab, EXT)).toBe(false)
    expect(messageAllowed({ type: 'SFMC_FETCH', url: 'https://mc.s7.exacttarget.com/cloud/fuelapi/data/v1/customobjectdata/key/X/rowset', method: 'GET' }, sfmcTab, EXT)).toBe(false)
    expect(messageAllowed({ type: 'SFMC_FETCH', url: auto + '/../../queries', method: 'GET' }, sfmcTab, EXT)).toBe(false)
  })
})
