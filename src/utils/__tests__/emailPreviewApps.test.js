import { describe, it, expect } from 'vitest'
import { presetPreview, readPreviewSetting, outlookWindows, gmailWeb, darkMediaMode, GMAIL_CLIP_BYTES, presetById } from '../emailPreviewModes.js'
import { mailAppGaps, emailCss } from '../emailClientSupport.js'

const EMAIL = `<!DOCTYPE html><html><head><style>
.btn{border-radius:6px;box-shadow:0 1px 2px #000;color:#fff;background:#0070d2}
.wrap{max-width:600px;display:flex}
@media (max-width:600px){.wrap{display:block}}
@font-face{font-family:Brand;src:url(b.woff2)}
</style></head><body>
<!--[if mso]><table width="600"><tr><td>OUTLOOK ONLY</td></tr></table><![endif]-->
<!--[if !mso]><!--><div class="wrap">NOT OUTLOOK</div><!--<![endif]-->
<a class="btn" style="border-radius:20px;padding:10px;background-image:url(x.png)">Buy</a>
<img src="a.png" alt="Logo" style="width:100px"></body></html>`

describe('#1117 preview presets', () => {
  it('reads the old single mode and the new setting', () => {
    expect(readPreviewSetting('mobile')).toEqual({ preset: 'phone', dark: false, imagesOff: false })
    expect(readPreviewSetting('dark')).toMatchObject({ dark: true })
    expect(readPreviewSetting('images-off')).toMatchObject({ imagesOff: true })
    expect(readPreviewSetting(JSON.stringify({ preset: 'outlook-win', dark: true }))).toEqual({ preset: 'outlook-win', dark: true, imagesOff: false })
    expect(readPreviewSetting(JSON.stringify({ preset: 'nope' })).preset).toBe('full')
    expect(readPreviewSetting('{broken').preset).toBe('full')
  })

  it('sizes the frame for devices and phone apps', () => {
    expect(presetPreview(EMAIL, { preset: 'phone' }).width).toBe(375)
    expect(presetPreview(EMAIL, { preset: 'gmail-app' }).width).toBe(360)
    expect(presetPreview(EMAIL, { preset: 'full' }).width).toBe(null)
    expect(presetById('unknown').id).toBe('full')
  })

  it('Outlook for Windows: Outlook-only parts shown, others hidden, ignored CSS dropped', () => {
    const out = outlookWindows(EMAIL)
    expect(out).toContain('OUTLOOK ONLY')
    expect(out).not.toContain('NOT OUTLOOK')
    expect(out).not.toMatch(/border-radius|box-shadow|max-width|@media|@font-face|background-image|display:flex/)
    expect(out).toContain('color:#fff')
    expect(out).toContain('padding:10px')
    expect(out).toContain('<!DOCTYPE html>')
  })

  it('Gmail web: clips after about 102 KB and drops styles over 16 KB', () => {
    const big = `<html><body>${'<p>row</p>'.repeat(12000)}<p>FOOTER</p></body></html>`
    const out = gmailWeb(big)
    expect(out).toContain('[Message clipped]')
    expect(out).not.toContain('FOOTER')
    expect(presetPreview(big, { preset: 'gmail-web' }).clipped).toBe(true)
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(GMAIL_CLIP_BYTES)
    const heavy = `<style>${'.a{color:red}'.repeat(1500)}</style><p>x</p>`
    expect(gmailWeb(heavy)).not.toContain('<style')
    expect(gmailWeb('<style>@font-face{font-family:B;src:url(b)}.a{color:red}</style>')).toBe('<style>.a{color:red}</style>')
    expect(gmailWeb(EMAIL)).not.toContain('[Message clipped]')
  })

  it("Apple Mail dark uses the email's own dark styles when it has them", () => {
    const own = '<style>.a{color:#000}@media (prefers-color-scheme: dark){.a{color:#fff}}</style><p class="a">x</p>'
    const out = darkMediaMode(own)
    expect(out).toContain('.a{color:#fff}')
    expect(out).not.toContain('invert(1)')
    expect(darkMediaMode('<p>x</p>')).toContain('invert(1)')
    expect(presetPreview(own, { preset: 'apple-iphone', dark: true }).html).not.toContain('invert(1)')
    expect(presetPreview(own, { preset: 'gmail-app', dark: true }).html).toContain('invert(1)')
  })

  it('switches combine with a mail app', () => {
    const out = presetPreview(EMAIL, { preset: 'outlook-win', imagesOff: true, dark: true }).html
    expect(out).toContain('Logo')
    expect(out).not.toMatch(/<img\b/)
    expect(out).toContain('invert(1)')
  })
})

describe('#1117 mail app gaps', () => {
  it('finds well-known gaps and names the apps', () => {
    const ids = mailAppGaps(EMAIL).map((g) => g.id)
    expect(ids).toEqual(expect.arrayContaining(['border-radius', 'box-shadow', 'max-width', 'flex-grid', 'media', 'font-face', 'bg-image', 'img-width']))
    expect(mailAppGaps(EMAIL).find((g) => g.id === 'border-radius').apps).toContain('Outlook (Windows)')
  })
  it('a media query condition is not a max-width style; dark-mode queries are not media gaps', () => {
    expect(mailAppGaps('<style>@media (max-width:600px){.a{width:100%}}</style>').map((g) => g.id)).toEqual(['media'])
    expect(mailAppGaps('<style>@media (prefers-color-scheme: dark){.a{color:#fff}}</style>')).toEqual([])
  })
  it('Outlook-only parts are left out, and a plain table email has no gaps', () => {
    expect(mailAppGaps('<!--[if mso]><v:roundrect style="border-radius:4px"></v:roundrect><![endif]-->')).toEqual([])
    expect(mailAppGaps('<table width="600"><tr><td style="color:#333;font-family:Arial">Hi</td></tr></table><img src="a" width="100" alt="">')).toEqual([])
  })
  it('collects style blocks and attributes', () => {
    expect(emailCss('<style>.a{x:1}</style><p style="y:2">')).toBe('.a{x:1}\n{y:2}')
  })
})
