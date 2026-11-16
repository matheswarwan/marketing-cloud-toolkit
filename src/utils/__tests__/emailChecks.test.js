import { describe, it, expect } from 'vitest'
import { checkEmail, hasUnsubscribeLink } from '../emailChecks.js'
import { darkMode, imagesOff, previewHtml } from '../emailPreviewModes.js'

const level = (r, id) => r.checks.find((c) => c.id === id)?.level
const good = `<html><head><meta name="viewport" content="width=device-width"><style>@media (max-width:600px){.w{width:100%}}</style></head><body>
<table width="600"><tr><td><img src="https://img.example.com/logo.png" alt="Logo" width="200" height="50">
<p>Hello, here is our spring news with plenty of words so this is clearly not an image-only email at all, friends and readers.</p>
<a href="https://example.com/shop">Shop</a>
<p>%%Member_Busname%% %%Member_Addr%% %%Member_City%%</p>
<a href="%%unsub_center_url%%">Unsubscribe</a></td></tr></table></body></html>`

describe('email checks', () => {
  it('passes a well-formed email', () => {
    const r = checkEmail({ html: good, text: '', subject: 'Spring news', preheader: 'What is new this month' }, { textGenerated: true })
    expect(r.counts.fail).toBe(0)
    expect(r.counts.warn).toBe(0)
    for (const id of ['unsubscribe', 'address', 'subject', 'preheader', 'text', 'alt', 'links', 'width', 'size']) expect(level(r, id)).toBe('pass')
  })

  it('fails what the law asks for and warns on what hurts delivery', () => {
    const html = '<table width="800"><tr><td><img src="http://x.com/a.png"><img src=""><a href="#">Click</a> <a href="http://x.com">site</a> To unsubscribe, reply STOP.</td></tr></table>'
    const r = checkEmail({ html, subject: 'x'.repeat(70), preheader: '' })
    expect(level(r, 'unsubscribe')).toBe('fail') // the word in text is not a link
    expect(level(r, 'address')).toBe('fail')
    expect(level(r, 'img-src')).toBe('fail')
    expect(level(r, 'subject')).toBe('warn')
    expect(level(r, 'preheader')).toBe('warn')
    expect(level(r, 'text')).toBe('warn')
    expect(level(r, 'alt')).toBe('warn')
    expect(level(r, 'https-img')).toBe('warn')
    expect(level(r, 'links')).toBe('warn')
    expect(level(r, 'https-link')).toBe('warn')
    expect(level(r, 'width')).toBe('warn')
    expect(level(r, 'image-only')).toBe('warn')
    expect(r.checks[0].level).toBe('fail') // worst first
  })

  it('finds unsubscribe links by SFMC string, target, alias or link text', () => {
    expect(hasUnsubscribeLink('<a href="%%=RedirectTo(@u)=%%">Manage your email preferences</a>')).toBe(true)
    expect(hasUnsubscribeLink('<a href="%%=CloudPagesURL(123)=%%" alias="Unsub footer">here</a>')).toBe(true)
    expect(hasUnsubscribeLink('', 'Unsubscribe: %%profile_center_url%%')).toBe(true)
    expect(hasUnsubscribeLink('<p>unsubscribe by replying</p>')).toBe(false)
  })

  it('takes a street address or postcode as a postal address, notes AMPscript and big emails', () => {
    expect(level(checkEmail({ html: '<p>Acme, 120 King Street West, Toronto ON M5H 1J9</p>' }), 'address')).toBe('pass')
    const r = checkEmail({ html: `%%[ SET @a = 1 ]%%<p>${'x'.repeat(110 * 1024)}</p>` })
    expect(level(r, 'ampscript')).toBe('info')
    expect(level(r, 'size')).toBe('warn')
  })
})

describe('email preview modes', () => {
  it('dark mode inverts the page, images back, and applies the email\'s own dark rules', () => {
    const out = darkMode('<html><head><style>@media (prefers-color-scheme: dark) { .x { color: #fff } }</style></head><body class="x">Hi</body></html>')
    expect(out).toContain('filter:invert(1) hue-rotate(180deg)')
    expect(out).toMatch(/<style> \.x \{ color: #fff \} <\/style>/)
    expect(out).not.toMatch(/prefers-color-scheme/)
  })

  it('images off shows alt text in sized boxes, escaped, and drops background images', () => {
    const out = imagesOff('<td background="bg.png"><img src="a.png" alt="<Sale>" width="300" height="100"><img src="b.png"></td>')
    expect(out).toContain('width:300px')
    expect(out).toContain('&lt;Sale&gt;')
    expect(out).toContain('[image, no alt text]')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('background="bg.png"')
    expect(previewHtml('<p>x</p>', 'mobile')).toBe('<p>x</p>')
    // Never before the doctype (live test, 2026-11-16): after <body>, <html> or the doctype.
    expect(previewHtml('<!DOCTYPE html><html><body style="x"><p>Hi</p></body></html>', 'dark')).toMatch(/^<!DOCTYPE html><html><body style="x"><style data-toolkit-preview>/)
    expect(previewHtml('<!DOCTYPE html><p>Hi</p>', 'images-off')).toMatch(/^<!DOCTYPE html><style data-toolkit-preview>/)
    expect(previewHtml('<html><head><title>t</title></head><body></body></html>', 'dark')).toMatch(/<title>t<\/title><style data-toolkit-preview>.*<\/style><\/head>/)
  })
})
