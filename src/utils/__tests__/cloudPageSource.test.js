import { describe, it, expect } from 'vitest'
import { htmlFromAsset, isCodeResource, codeLanguage, codeResourceIdOf, codeFromResource, fetchCloudPageSource } from '../cloudPagesApi.js'

describe('CloudPage source (feedback #1010, #1011)', () => {
  it('fills slots and blocks into the page HTML', () => {
    const asset = {
      content: '<html><div data-type="slot" data-key="main"></div></html>',
      slots: { main: { content: '<p>Hi</p><div data-type="block" data-key="b1"></div>', blocks: { b1: { content: '<b>Block</b>' } } } },
    }
    expect(htmlFromAsset(asset)).toBe('<html><p>Hi</p><b>Block</b></html>')
  })

  it('reads the html view when the content is only the published URL', () => {
    const asset = { content: '{"url":"https://pub.s4.sfmc-content.com/x"}', views: { html: { content: '<h1>Page</h1>' } } }
    expect(htmlFromAsset(asset)).toBe('<h1>Page</h1>')
    expect(htmlFromAsset({ content: '{"url":"https://x.test/a"}' })).toBe('')
    expect(htmlFromAsset(null)).toBe('')
  })

  it('tells code resources apart and names their language', () => {
    expect(isCodeResource({ assetType: { name: 'jscoderesource' } })).toBe(true)
    expect(isCodeResource({ assetType: { name: 'webpage' }, meta: { cloudPages: { id: 5 } } })).toBe(false)
    expect(isCodeResource({ assetType: { name: 'x' }, meta: { cloudPages: { codeResourceId: 9 } } })).toBe(true)
    expect(codeLanguage({ assetType: { name: 'jscoderesource', displayName: 'JavaScript Code Resource' } })).toBe('js')
    expect(codeLanguage({ assetType: { name: 'csscoderesource' } })).toBe('css')
    expect(codeLanguage({ assetType: { name: 'jsoncoderesource' } })).toBe('json')
    expect(codeLanguage({ assetType: { name: 'rsscoderesource' } })).toBe('xml')
    expect(codeLanguage({ assetType: { name: 'textcoderesource' } })).toBe('txt')
  })

  it('finds the code resource ID and its text', () => {
    expect(codeResourceIdOf({ meta: { cloudPages: { codeResourceId: 1923417 } } })).toBe('1923417')
    expect(codeResourceIdOf({ meta: { cloudPages: { id: 7 } } })).toBe('7')
    expect(codeResourceIdOf({ meta: { cloudPages: { id: 7 } } }, { strict: true })).toBeNull()
    expect(codeFromResource({ content: 'var a = 1' })).toBe('var a = 1')
    expect(codeFromResource({ entities: [{ content: 'b' }] })).toBe('b')
    expect(codeFromResource(null)).toBe('')
  })

  it('reads the asset from the CloudPages host, falling back to Content Builder, then the code resource', async () => {
    const calls = []
    const fetch = async (url) => {
      calls.push(url)
      if (url.includes('cloud-pages') && url.includes('/assets/')) throw new Error('no session')
      if (url.includes('/assets/')) return { assetType: { name: 'jscoderesource' }, meta: { cloudPages: { id: 1923417 } } }
      return { content: 'console.log(1)' }
    }
    const r = await fetchCloudPageSource('s10', { id: 488193 }, fetch)
    expect(calls).toEqual([
      'https://cloud-pages.s10.marketingcloudapps.com/fuelapi/asset/v1/content/assets/488193',
      'https://content-builder.s10.marketingcloudapps.com/fuelapi/asset/v1/content/assets/488193',
      'https://cloud-pages.s10.marketingcloudapps.com/fuelapi/internal/v2/cloudpages/code-resources/1923417',
    ])
    expect(r).toMatchObject({ code: 'console.log(1)', language: 'js', errors: [] })
  })

  it('reads a landing page\'s code from the Web Page asset its thumbnailRefAssetId names (user capture)', async () => {
    const calls = []
    const page = { id: 126396, assetType: { id: 247, name: 'landingpage' }, content: '{"url":"https://x.pub.s13.sfmc-content.com/abc"}', meta: { thumbnailRefAssetId: 126397, cloudPages: { publishDate: '2026-10-25' } }, availableViews: [] }
    const web = { id: 126397, assetType: { id: 205, name: 'webpage' }, views: { html: { content: '<!-- grid -->\n%%[ SET @a = 1 ]%%<table></table>', slots: { col1: { design: '<p>Drop blocks or content here</p>' } } } } }
    const fetch = async (url) => { calls.push(url); return url.endsWith('/126397') ? web : page }
    const r = await fetchCloudPageSource('s13', { id: 126396 }, fetch)
    expect(calls).toEqual([
      'https://cloud-pages.s13.marketingcloudapps.com/fuelapi/asset/v1/content/assets/126396',
      'https://cloud-pages.s13.marketingcloudapps.com/fuelapi/asset/v1/content/assets/126397',
    ])
    expect(r.html).toBe('<!-- grid -->\n%%[ SET @a = 1 ]%%<table></table>')
    expect(r.contentAsset.id).toBe(126397)
    expect(r.errors).toEqual([])
  })

  it('says so when the Web Page asset cannot be read', async () => {
    const fetch = async (url) => { if (url.endsWith('/7')) throw new Error('403'); return { id: 6, meta: { thumbnailRefAssetId: 7 } } }
    const r = await fetchCloudPageSource('s13', { id: 6 }, fetch)
    expect(r.html).toBe('')
    expect(r.errors).toEqual(['Page content (asset 7): 403'])
  })
})
