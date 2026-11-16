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
