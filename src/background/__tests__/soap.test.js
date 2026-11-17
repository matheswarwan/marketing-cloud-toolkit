import { describe, it, expect, vi } from 'vitest'
import { soapUrlFromEndpoints, soapEndpoint, soapRetrieve, retrieveEnvelope } from '../soap.js'

const OK = '<soap:Envelope><soap:Body><RetrieveResponseMsg><OverallStatus>OK</OverallStatus></RetrieveResponseMsg></soap:Body></soap:Envelope>'
const request = { stack: 's13', objectType: 'AccountUser', properties: ['ID'] }
const answer = (text = OK, status = 200) => ({ ok: status < 400, status, text: async () => text })
const token = async () => 'tok'

describe('SOAP address from the account endpoint list (feedback #1102)', () => {
  it('takes the tenant SOAP address', () => {
    expect(soapUrlFromEndpoints([
      { type: 'rest', url: 'https://abc-123.rest.marketingcloudapis.com/' },
      { type: 'soap', url: 'https://ABC-123.soap.marketingcloudapis.com/Service.asmx' },
    ])).toBe('https://abc-123.soap.marketingcloudapis.com/Service.asmx')
  })

  it('takes the stack address where the list names it (as on s10)', () => {
    expect(soapUrlFromEndpoints([{ type: 'soap', url: 'https://webservice.s10.exacttarget.com/Service.asmx' }]))
      .toBe('https://webservice.s10.exacttarget.com/Service.asmx')
  })

  it('refuses anything outside the two SFMC host forms', () => {
    for (const url of ['https://evil.example.com/Service.asmx', 'http://abc.soap.marketingcloudapis.com/Service.asmx',
      'https://abc.soap.marketingcloudapis.com.evil.com/Service.asmx', 'https://x.rest.marketingcloudapis.com/', 'not a url']) {
      expect(soapUrlFromEndpoints([{ type: 'soap', url }])).toBeNull()
    }
    expect(soapUrlFromEndpoints(null)).toBeNull()
  })

  it('reads the list once per stack and asks again after a failure', async () => {
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('LOGIN_REQUIRED'))
      .mockResolvedValue({ items: [{ type: 'soap', url: 'https://t1.soap.marketingcloudapis.com/Service.asmx' }] })
    expect(await soapEndpoint('s91', { fetchJson })).toBeNull()
    await Promise.resolve()
    expect(await soapEndpoint('s91', { fetchJson })).toBe('https://t1.soap.marketingcloudapis.com/Service.asmx')
    expect(await soapEndpoint('s91', { fetchJson })).toBe('https://t1.soap.marketingcloudapis.com/Service.asmx')
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })
})

describe('soapRetrieve addresses (feedback #1102)', () => {
  it('posts to the tenant address with a matching <a:To>', async () => {
    const fetch = vi.fn(async () => answer())
    await soapRetrieve(request, { fetch, token, drop: () => {}, endpoint: async () => 'https://t1.soap.marketingcloudapis.com/Service.asmx' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://t1.soap.marketingcloudapis.com/Service.asmx')
    expect(fetch.mock.calls[0][1].body).toContain('<a:To s:mustUnderstand="1">https://t1.soap.marketingcloudapis.com/Service.asmx</a:To>')
  })

  it('falls back to webservice.<stack> when the tenant host cannot be reached', async () => {
    const fetch = vi.fn(async (url) => { if (url.includes('t1.soap')) throw new TypeError('Failed to fetch'); return answer() })
    await soapRetrieve(request, { fetch, token, drop: () => {}, endpoint: async () => 'https://t1.soap.marketingcloudapis.com/Service.asmx' })
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://t1.soap.marketingcloudapis.com/Service.asmx', 'https://webservice.s13.exacttarget.com/Service.asmx'])
  })

  it('says which host could not be reached instead of a bare "Failed to fetch"', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(soapRetrieve(request, { fetch, token, drop: () => {}, endpoint: async () => null }))
      .rejects.toThrow("Could not reach SFMC's SOAP API for s13 (webservice.s13.exacttarget.com): Failed to fetch")
  })

  it('retries once with a fresh token on the same address', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer('Login failed', 401)).mockResolvedValueOnce(answer())
    const drop = vi.fn()
    await soapRetrieve(request, { fetch, token, drop, endpoint: async () => 'https://t1.soap.marketingcloudapis.com/Service.asmx' })
    expect(drop).toHaveBeenCalledWith('s13')
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(Array(2).fill('https://t1.soap.marketingcloudapis.com/Service.asmx'))
  })

  it('still refuses an unknown stack before any call', async () => {
    const fetch = vi.fn()
    await expect(soapRetrieve({ ...request, stack: 'evil.com/x' }, { fetch, token, endpoint: async () => null })).rejects.toThrow('Unknown stack')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('escapes the address in the envelope', () => {
    expect(retrieveEnvelope(request, 't', 'https://a.soap.marketingcloudapis.com/Service.asmx?x=<y>')).toContain('?x=&lt;y&gt;</a:To>')
  })
})
