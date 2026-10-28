import { describe, it, expect, vi } from 'vitest'
import { withReconnect, searchError, isConnectionError } from '../sfmcErrors.js'

const APP = { id: 'automationStudio', name: 'Automation Studio', url: 'https://mc.s13.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/' }
const noSession = () => Object.assign(new Error('Automation Studio sent a web page (its login) instead of data, so it has no session.'), { code: 'SFMC_SESSION_UNAVAILABLE', app: APP })

describe('search connection errors (feedback #93)', () => {
  it('starts the app session once and searches again', async () => {
    const fn = vi.fn().mockRejectedValueOnce(noSession()).mockResolvedValueOnce({ entries: [1] })
    const send = vi.fn(async () => ({ ok: true }))
    expect(await withReconnect('s13', fn, { send })).toEqual({ entries: [1] })
    expect(send).toHaveBeenCalledWith({ type: 'SFMC_CONNECT_APP', stack: 's13', appId: 'automationStudio' })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after one try and names the app, with a link to log in', async () => {
    const fn = vi.fn(async () => { throw noSession() })
    const send = vi.fn(async () => ({ error: 'Could not start a Automation Studio session on stack s13.', code: 'SFMC_SESSION_UNAVAILABLE' }))
    const e = await withReconnect('s13', fn, { send }).catch((x) => x)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(searchError(e, 'search automations')).toEqual({
      message: 'Could not connect to Automation Studio: Could not start a Automation Studio session on stack s13.',
      connection: true, appName: 'Automation Studio', appUrl: APP.url,
    })
  })

  it('leaves other errors alone', async () => {
    const err = Object.assign(new Error('SFMC API error 400: bad'), { status: 400 })
    const send = vi.fn()
    await expect(withReconnect('s13', async () => { throw err }, { send })).rejects.toBe(err)
    expect(send).not.toHaveBeenCalled()
    expect(isConnectionError(err)).toBe(false)
    expect(searchError(err, 'search automations').message).toBe('Could not search automations: SFMC API error 400: bad')
  })
})
