// Email preview modes (user, 2026-11-16; idea from VeLens's previews, our own code):
// the email's HTML changed so the sandboxed preview shows it in dark mode, with images
// off, or at phone width. Approximations, said so on the page: every mail app does its
// own thing.

export const PREVIEW_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'dark', label: 'Dark', note: 'Like mail apps that invert light colours (Gmail and Outlook apps on phones). Apps that only honour @media (prefers-color-scheme: dark) use the email\'s own dark styles, shown here too.' },
  { id: 'images-off', label: 'Images off', note: 'How it reads when images are blocked (the default in many mail apps): each image is a box with its alt text; background images are gone.' },
  { id: 'mobile', label: 'Mobile', note: 'At 375 pixels wide, a typical phone. Fixed widths wider than that scroll sideways.' },
]
export const MOBILE_FRAME_WIDTH = 375

// The preview's styles go in the head, else right after <html> or the doctype: never
// before <!DOCTYPE>, which would put the email into quirks mode (live test, 2026-11-16:
// an email without a <head> did).
const inject = (html, css) => {
  const tag = `<style data-toolkit-preview>${css}</style>`
  for (const re of [/<\/head\s*>/i, /<body\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html)
    if (!m) continue
    return re.source.startsWith('<\\/head') ? `${html.slice(0, m.index)}${tag}${html.slice(m.index)}` : `${html.slice(0, m.index + m[0].length)}${tag}${html.slice(m.index + m[0].length)}`
  }
  return `${tag}${html}`
}

/**
 * Dark: the email's own `prefers-color-scheme: dark` rules are applied unconditionally,
 * then the page is inverted the way phone mail apps do it (images inverted back).
 */
export function darkMode(html) {
  let out = String(html || '')
  // Lift the email's own dark rules out of their @media wrapper so they apply.
  out = out.replace(/@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gi, '$1')
  return inject(out, 'html{background:#fff;filter:invert(1) hue-rotate(180deg)}img,picture,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}')
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

/** Images off: each <img> becomes a grey box of its size with its alt text; no background images. */
export function imagesOff(html) {
  let out = String(html || '').replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    const alt = attr(tag, 'alt')
    const w = Number(attr(tag, 'width')) || null
    const h = Number(attr(tag, 'height')) || null
    const size = `${w ? `width:${w}px;max-width:100%;` : ''}${h ? `height:${h}px;` : 'min-height:24px;'}`
    const label = alt == null ? '[image, no alt text]' : alt
    return `<span style="display:inline-block;box-sizing:border-box;${size}border:1px dashed #9ca3af;background:#f3f4f6;color:#374151;font:12px/1.4 sans-serif;padding:4px;overflow:hidden;vertical-align:middle">${esc(label)}</span>`
  })
  out = out.replace(/\sbackground\s*=\s*(["'])[^"']*\1/gi, '')
  return inject(out, '*{background-image:none!important}')
}

/** The HTML for a preview mode (mobile only narrows the frame, so its HTML is unchanged). */
export function previewHtml(html, mode) {
  if (mode === 'dark') return darkMode(html)
  if (mode === 'images-off') return imagesOff(html)
  return String(html || '')
}

// #1117 (feedback: preview like Outlook, Gmail, sizes, desktop): device sizes and mail-app
// approximations, combined with the Dark and Images off switches. All local: nothing is
// sent anywhere, and every mail app has its own rules, so these are labelled approximations.

export const DEVICE_PRESETS = [
  { id: 'full', label: 'Full width', width: null },
  { id: 'phone-s', label: 'Small phone (320)', width: 320 },
  { id: 'phone', label: 'Phone (375)', width: 375 },
  { id: 'phone-l', label: 'Large phone (414)', width: 414 },
  { id: 'tablet', label: 'Tablet (768)', width: 768 },
  { id: 'desktop', label: 'Desktop (1024)', width: 1024 },
]

export const APP_PRESETS = [
  { id: 'apple-iphone', label: 'Apple Mail, iPhone', width: 375, dark: 'media', note: 'iPhone width. Dark uses the email\'s own prefers-color-scheme styles when it has them, else colours are inverted.' },
  { id: 'gmail-app', label: 'Gmail app, Android', width: 360, dark: 'invert', note: 'Phone width. Dark inverts light colours, as the Gmail app does.' },
  { id: 'gmail-web', label: 'Gmail, web', width: null, dark: 'invert', gmail: true, note: 'HTML after about 102 KB is cut ("Message clipped"), styles over 16 KB are dropped, web fonts fall back.' },
  { id: 'outlook-win', label: 'Outlook, Windows', width: null, dark: 'invert', mso: true, note: 'Shows the email\'s Outlook-only ([if mso]) parts and drops CSS the Word engine ignores: rounded corners, shadows, max-width, background images, flex and grid, media queries, web fonts.' },
  { id: 'outlook-web', label: 'Outlook.com and new Outlook', width: null, dark: 'invert', note: 'Full width. Dark inverts light colours.' },
]

export const ALL_PRESETS = [...DEVICE_PRESETS, ...APP_PRESETS]
export const presetById = (id) => ALL_PRESETS.find((p) => p.id === id) || DEVICE_PRESETS[0]

/** Reads a stored preview setting, including the old single mode (normal, dark, images-off, mobile). */
export function readPreviewSetting(raw) {
  const out = { preset: 'full', dark: false, imagesOff: false }
  if (!raw) return out
  if (raw === 'mobile') return { ...out, preset: 'phone' }
  if (raw === 'dark') return { ...out, dark: true }
  if (raw === 'images-off') return { ...out, imagesOff: true }
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return { preset: ALL_PRESETS.some((p) => p.id === v.preset) ? v.preset : 'full', dark: !!v.dark, imagesOff: !!v.imagesOff }
  } catch { /* old or broken value */ }
  return out
}

const DARK_MEDIA = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gi

/** Apple Mail style dark: the email's own dark rules when it has them, else inverted. */
export function darkMediaMode(html) {
  const s = String(html || '')
  DARK_MEDIA.lastIndex = 0
  if (!DARK_MEDIA.test(s)) return darkMode(s)
  DARK_MEDIA.lastIndex = 0
  return inject(s.replace(DARK_MEDIA, '$1'), 'html{background:#000}')
}

// CSS properties Outlook for Windows (Word rendering engine) ignores.
const OUTLOOK_DROP = ['border-radius', 'box-shadow', 'max-width', 'max-height', 'min-width', 'background-image', 'background-size', 'background-position', 'opacity', 'transform', 'transition', 'animation', 'object-fit', 'position', 'gap', 'filter']

// Removes whole @rule blocks (with one level of nested braces) whose prelude matches.
function dropAtRules(css, name) {
  return css.replace(new RegExp(`@${name}[^{]*\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`, 'gi'), '')
}

function dropDeclarations(css) {
  let out = css
  for (const p of OUTLOOK_DROP) out = out.replace(new RegExp(`(^|[;{\\s"'])${p}\\s*:[^;}"']*;?`, 'gi'), '$1')
  out = out.replace(/(^|[;{\s"'])display\s*:\s*(?:inline-)?(?:flex|grid)\s*;?/gi, '$1')
  out = out.replace(/(^|[;{\s"'])background\s*:[^;}"']*url\([^)]*\)[^;}"']*;?/gi, '$1')
  out = out.replace(/(^|[;{\s"'])background\s*:[^;}"']*gradient\([^;}"']*;?/gi, '$1')
  return out
}

/**
 * Outlook for Windows: unwraps <!--[if mso]> (and [if gte mso 9], [if mso | IE]) parts,
 * removes the <!--[if !mso]><!--> ... <!--<![endif]--> parts Outlook skips, and drops CSS the
 * Word engine ignores, in <style> blocks and style attributes.
 */
export function outlookWindows(html) {
  let out = String(html || '')
  out = out.replace(/<!--\[if\s+!mso[^\]]*\]><!-->([\s\S]*?)<!--<!\[endif\]-->/gi, '')
  out = out.replace(/<!--\[if\s+[^\]]*mso[^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi, (m, inner) => (/!\s*mso/i.test(m.slice(0, 20)) ? '' : inner))
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + dropDeclarations(dropAtRules(dropAtRules(dropAtRules(css, 'media'), 'font-face'), 'keyframes')) + b)
  out = out.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (m, q, css) => ` style=${q}${dropDeclarations(css)}${q}`)
  return out
}

export const GMAIL_CLIP_BYTES = 102 * 1024
export const GMAIL_STYLE_LIMIT = 16 * 1024

/**
 * Gmail on the web: <style> blocks dropped when together they pass 16 KB, @font-face removed,
 * and the HTML cut after about 102 KB with Gmail's "[Message clipped]" line.
 */
export function gmailWeb(html) {
  let out = String(html || '')
  const styles = [...out.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  const styleSize = styles.reduce((n, m) => n + new TextEncoder().encode(m[1]).length, 0)
  if (styleSize > GMAIL_STYLE_LIMIT) out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  else out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + dropAtRules(css, 'font-face') + b)
  const bytes = new TextEncoder().encode(out)
  if (bytes.length > GMAIL_CLIP_BYTES) {
    let cut = new TextDecoder().decode(bytes.slice(0, GMAIL_CLIP_BYTES))
    cut = cut.replace(/<[^>]*$/, '') // no half tag at the cut
    out = `${cut}<div style="font:13px/1.5 Arial,sans-serif;color:#5f6368;padding:12px 0">[Message clipped]&nbsp; <u style="color:#1a73e8">View entire message</u></div>`
  }
  return out
}

/** The preview HTML and frame width for a preset plus the Dark and Images off switches. */
export function presetPreview(html, { preset = 'full', dark = false, imagesOff: noImages = false } = {}) {
  const p = presetById(preset)
  let out = String(html || '')
  if (p.mso) out = outlookWindows(out)
  if (p.gmail) out = gmailWeb(out)
  if (noImages) out = imagesOff(out)
  if (dark) out = p.dark === 'media' ? darkMediaMode(out) : darkMode(out)
  return { html: out, width: p.width, clipped: !!p.gmail && new TextEncoder().encode(String(html || '')).length > GMAIL_CLIP_BYTES }
}
