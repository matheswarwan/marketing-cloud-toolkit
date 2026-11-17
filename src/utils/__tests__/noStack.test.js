import { describe, it, expect, vi } from 'vitest'
import { soapRetrieveAll } from '../soapApi.js'
import { loadBusinessUnits } from '../setupApi.js'
import { sfmcFetch } from '../sfmcApi.js'
import { noStackError } from '../stackDetection.js'
import { searchError } from '../sfmcErrors.js'

// A page that loads before a stack is known (opened before logging in to SFMC) says so,
// instead of "Unknown stack" (SOAP) or an empty list (business units).
describe('no stack yet', () => {
  it('is a connection error with a clear message', () => {
    const shown = searchError(noStackError(), 'read the users')
    expect(shown.connection).toBe(true)
    expect(shown.message).toMatch(/No logged-in Marketing Cloud tab found/)
  })

  it('SOAP reads refuse before asking the service worker', async () => {
    const retrieve = vi.fn()
    await expect(soapRetrieveAll(null, 'AccountUser', ['ID'], { retrieve })).rejects.toMatchObject({ code: 'SFMC_LOGIN_REQUIRED' })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('business units are an error, not an empty list', async () => {
    await expect(loadBusinessUnits(null)).rejects.toMatchObject({ code: 'SFMC_LOGIN_REQUIRED' })
  })

  it('REST calls to a host built without a stack are refused', async () => {
    globalThis.chrome = { runtime: { sendMessage: vi.fn() } }
    await expect(sfmcFetch('https://mc.null.exacttarget.com/cloud/fuelapi/x', 'GET')).rejects.toMatchObject({ code: 'SFMC_LOGIN_REQUIRED' })
    await expect(sfmcFetch('https://mc-x.undefined.marketingcloudapps.com/y', 'GET')).rejects.toMatchObject({ code: 'SFMC_LOGIN_REQUIRED' })
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    delete globalThis.chrome
  })
})
