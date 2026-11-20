// #1117: which features in an email's code common mail apps ignore. Our own short list of
// well-known gaps (written here, not copied from a data set); caniemail.com has the full
// tables. Checked locally from the HTML; nothing is sent anywhere.

const OW = 'Outlook (Windows)'
const GM = 'Gmail'
const GMI = 'Gmail with a non-Google account'

// test(html, css, rawCss): css is the text of every <style> block plus every style attribute,
// with @media conditions taken out (so "@media (max-width: 600px)" is not a max-width style).
export const CLIENT_GAPS = [
  { id: 'script', feature: 'Scripts', apps: ['Every mail app'], detail: 'Mail apps remove <script> tags, so nothing in them runs.', test: (h) => /<script\b/i.test(h) },
  { id: 'form', feature: 'Forms', apps: [GM, OW, 'most mobile apps'], detail: 'Forms are blocked or will not submit; link to a CloudPage instead.', test: (h) => /<(form|input|select|textarea)\b/i.test(h) },
  { id: 'svg', feature: 'Inline SVG', apps: [GM, OW], detail: 'Inline <svg> is not shown; use a PNG.', test: (h) => /<svg\b/i.test(h) },
  { id: 'video', feature: 'Video', apps: [GM, OW, 'Outlook.com'], detail: 'Only Apple Mail and a few others play <video>; give a linked image as the fallback.', test: (h) => /<video\b/i.test(h) },
  { id: 'border-radius', feature: 'Rounded corners (border-radius)', apps: [OW], detail: 'Corners show square; VML (v:roundrect) is the usual Outlook fallback for buttons.', test: (h, c) => /border-radius\s*:/i.test(c) },
  { id: 'bg-image', feature: 'CSS background images', apps: [OW], detail: 'Ignored; use the background attribute with a VML fallback, and a background colour.', test: (h, c) => /background(-image)?\s*:[^;"'}]*url\(/i.test(c) },
  { id: 'gradient', feature: 'Gradients', apps: [OW], detail: 'linear-gradient and radial-gradient are ignored; set a solid background colour first.', test: (h, c) => /gradient\(/i.test(c) },
  { id: 'max-width', feature: 'max-width', apps: [OW], detail: 'Ignored, so a fluid layout stretches; wrap it in a fixed-width table inside <!--[if mso]>.', test: (h, c) => /max-width\s*:/i.test(c) },
  { id: 'flex-grid', feature: 'Flexbox and grid', apps: [OW, GMI], detail: 'display:flex and display:grid are ignored; build columns with tables.', test: (h, c) => /display\s*:\s*(inline-)?(flex|grid)/i.test(c) },
  { id: 'position', feature: 'Positioning', apps: [GM, OW], detail: 'position (absolute, fixed, relative offsets) is removed or ignored.', test: (h, c) => /(^|[;{\s"'])position\s*:\s*(absolute|fixed|relative|sticky)/i.test(c) },
  { id: 'media', feature: 'Media queries', apps: [OW, GMI], detail: 'Ignored, so the desktop layout shows; make the default layout work on phones too.', test: (h, c, raw) => /@media\b(?![^{]*prefers-color-scheme)/i.test(raw) },
  { id: 'font-face', feature: 'Web fonts', apps: [GM, OW, 'Outlook.com'], detail: 'Only Apple Mail, iOS Mail and a few others load @font-face or linked fonts; set web-safe fallbacks in font-family.', test: (h, c) => /@font-face|<link\b[^>]*fonts\.googleapis/i.test(h + c) },
  { id: 'box-shadow', feature: 'Shadows', apps: [OW, GM], detail: 'box-shadow is ignored.', test: (h, c) => /box-shadow\s*:/i.test(c) },
  { id: 'css-vars', feature: 'CSS variables', apps: [GM, OW], detail: 'var(--...) is not supported; write the values out.', test: (h, c) => /var\(--/i.test(c) },
  { id: 'animation', feature: 'Animation', apps: [GM, OW], detail: '@keyframes and transitions do not run; make the first frame complete.', test: (h, c) => /@keyframes|animation\s*:|transition\s*:/i.test(c) },
  { id: 'hover', feature: ':hover styles', apps: [OW, 'most mobile apps'], detail: 'Hover effects do not show on phones or in Outlook; never put content only in a hover state.', test: (h, c) => /:hover\b/i.test(c) },
  { id: 'rgba', feature: 'rgba() and hsla() colours', apps: [OW], detail: 'Colours with transparency may be dropped; use solid hex colours.', test: (h, c) => /(rgba|hsla)\(/i.test(c) },
  { id: 'object-fit', feature: 'object-fit', apps: [GM, OW], detail: 'Ignored; crop images before uploading.', test: (h, c) => /object-fit\s*:/i.test(c) },
  { id: 'img-width', feature: 'Images without a width attribute', apps: [OW], detail: 'Outlook ignores CSS widths on images and shows them at full size; add width="..." on each <img>.', test: (h) => [...h.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].some((m) => !/\swidth\s*=/i.test(m[0])) },
  { id: 'style-size', feature: 'Styles over 16 KB', apps: [GM], detail: 'Gmail drops every <style> block when they pass about 16 KB together; inline the important styles.', test: (h) => [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((n, m) => n + m[1].length, 0) > 16 * 1024 },
]

/** The style text of an email: <style> blocks and style attributes. */
export function emailCss(html) {
  const s = String(html || '')
  const blocks = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
  const attrs = [...s.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map((m) => `{${m[2]}}`)
  return [...blocks, ...attrs].join('\n')
}

/** Features in this email that some mail apps ignore: [{ id, feature, apps, detail }]. */
export function mailAppGaps(html) {
  const h = String(html || '')
  // Outlook-only parts are written for Outlook: leave them out of the check.
  const body = h.replace(/<!--\[if\s+[^\]]*mso[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
  const raw = emailCss(body)
  const css = raw.replace(/@media[^{]*\{/gi, '{')
  return CLIENT_GAPS.filter((g) => g.test(body, css, raw)).map(({ id, feature, apps, detail }) => ({ id, feature, apps, detail }))
}
