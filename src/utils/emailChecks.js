// Email checks (user, 2026-11-16; idea from VeLens's Email Health card, our own rules):
// things to fix before a send, read from the email's own HTML, text, subject line and
// preheader. Pure and local: nothing is sent anywhere.
//
// Each check: { id, title, level: 'fail' | 'warn' | 'pass' | 'info', detail, count? }.
// "fail" is for what breaks the law or the send (no unsubscribe link, no postal address);
// "warn" for what hurts delivery or display; "info" for what cannot be judged from here.

const GMAIL_CLIP = 102 * 1024 // Gmail cuts an email's HTML after about 102 KB
const MOBILE_WIDTH = 640 // wider fixed widths scroll sideways on phones
const SUBJECT_LONG = 60 // most inboxes cut the subject line around here
const PREHEADER_LONG = 140

// SFMC personalization strings that give an unsubscribe or preference centre link.
const UNSUB_STRING_RE = /%%\s*(?:unsub_center_url|subscription_center_url|profile_center_url|unsubscribe_url)\s*%%|\b(?:unsub_center_url|subscription_center_url|profile_center_url)\b/i
const UNSUB_WORDS_RE = /unsub|opt[\s-]?out|preference|manage (?:your )?(?:email|subscription)/i
// A tag, reading quoted attribute values whole (alt="<Sale>" has a > inside).
const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`
// SFMC's account address strings, or something that reads like a street address.
const ADDRESS_STRINGS_RE = /%%\s*member_(?:addr|busname|city|state|postalcode|country)\s*%%/i
const STREET_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,40}\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|suite|ste\.?|floor|place|pl\.?|court|ct\.?|parkway|square|sq\.?|highway|hwy)\b/i
const POSTCODE_RE = /\b(?:[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/ // Canada, US, UK

const stripScripts = (html) => String(html || '')
  .replace(/%%\[[\s\S]*?\]%%/g, ' ') // AMPscript blocks (their text is code, not content)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
const textOf = (html) => stripScripts(html).replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()

function tags(html, name) {
  const re = new RegExp(`<${name}\\b${TAG_BODY}>`, 'gi')
  return String(html || '').match(re) || []
}
function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

/**
 * An unsubscribe link: SFMC's unsubscribe or preference centre string anywhere (it is only
 * ever a link), or a link whose target or words say unsubscribe, opt out or preferences
 * (a CloudPage built with CloudPagesURL, an alias). The word alone in body text is not one.
 */
export function hasUnsubscribeLink(html, text = '') {
  if (UNSUB_STRING_RE.test(`${html}\n${text}`)) return true
  for (const m of String(html || '').matchAll(new RegExp(`<a\\b(${TAG_BODY})>([\\s\\S]*?)</a>`, 'gi'))) {
    const href = attr(`<a ${m[1]}>`, 'href') || ''
    const alias = attr(`<a ${m[1]}>`, 'alias') || ''
    if (UNSUB_WORDS_RE.test(href) || UNSUB_WORDS_RE.test(alias) || UNSUB_WORDS_RE.test(m[2].replace(/<[^>]+>/g, ' '))) return true
  }
  return false
}

/**
 * @param parts { html, text, subject, preheader } (contentEmails.emailParts)
 * @param opts.textGenerated true when SFMC builds the text version from the HTML (views.text.generateFrom)
 * @returns {{ checks: [], counts: { fail, warn, pass, info } }}
 */
export function checkEmail({ html = '', text = '', subject = '', preheader = '' } = {}, { textGenerated = false } = {}) {
  const checks = []
  const add = (id, title, level, detail, count) => checks.push({ id, title, level, detail, ...(count != null ? { count } : {}) })
  const body = String(html || '')
  const all = `${body}\n${text}`
  // ── Must-haves (CAN-SPAM, CASL, PECR) ──
  if (hasUnsubscribeLink(body, text)) add('unsubscribe', 'Unsubscribe link', 'pass', 'Found an unsubscribe or preference centre link.')
  else add('unsubscribe', 'Unsubscribe link', 'fail', 'No unsubscribe link found (such as %%unsub_center_url%% or a link with "unsubscribe" in it). Commercial email must have one; SFMC adds its footer only to some send classifications. A link built in AMPscript cannot be seen here: check it in a test send.')
  if (ADDRESS_STRINGS_RE.test(all)) add('address', 'Postal address', 'pass', 'Uses the account address strings (%%Member_Addr%% and the like).')
  else if (STREET_RE.test(textOf(body)) || POSTCODE_RE.test(textOf(body))) add('address', 'Postal address', 'pass', 'Something that reads like a postal address is in the email.')
  else add('address', 'Postal address', 'fail', 'No postal address found. Commercial email must show the sender\'s physical address; %%Member_Busname%%, %%Member_Addr%%, %%Member_City%%, %%Member_State%% and %%Member_PostalCode%% fill it in from the account settings.')

  // ── Inbox ──
  if (!String(subject).trim()) add('subject', 'Subject line', 'fail', 'The email has no subject line.')
  else if (String(subject).length > SUBJECT_LONG) add('subject', 'Subject line', 'warn', `${String(subject).length} characters: most inboxes show about ${SUBJECT_LONG}, phones fewer. Put the point first.`)
  else add('subject', 'Subject line', 'pass', `${String(subject).length} characters.`)
  if (!String(preheader).trim()) add('preheader', 'Preheader', 'warn', 'No preheader: inboxes show the first text of the email instead (often "View in browser").')
  else if (String(preheader).length > PREHEADER_LONG) add('preheader', 'Preheader', 'warn', `${String(preheader).length} characters: inboxes show about 40 to 130.`)
  else add('preheader', 'Preheader', 'pass', `${String(preheader).length} characters.`)

  // ── Text version ──
  if (textGenerated) add('text', 'Text version', 'pass', 'SFMC builds it from the HTML when the email is sent.')
  else if (String(text).trim().length >= 20) add('text', 'Text version', 'pass', 'The email has its own text version.')
  else add('text', 'Text version', 'warn', 'No text version: some spam filters and mail apps use it. In Content Builder, set the text version to build from the HTML.')

  // ── Images ──
  const imgs = tags(body, 'img')
  if (imgs.length) {
    const noAlt = imgs.filter((t) => attr(t, 'alt') == null)
    const insecure = imgs.filter((t) => /^http:\/\//i.test(attr(t, 'src') || ''))
    const broken = imgs.filter((t) => { const s = (attr(t, 'src') || '').trim(); return !s || s === '#' || /^(?:file:|\/\/localhost|data:,|\.\.?\/|\/(?!\/))/i.test(s) })
    if (noAlt.length) add('alt', 'Image alt text', 'warn', `${noAlt.length} of ${imgs.length} images have no alt attribute: with images off (the default in many mail apps) nothing shows in their place, and screen readers read the file name. Use alt="" for spacers.`, noAlt.length)
    else add('alt', 'Image alt text', 'pass', `All ${imgs.length} images have alt text.`)
    if (insecure.length) add('https-img', 'Images over https', 'warn', `${insecure.length} images load over http: some mail apps block them or warn.`, insecure.length)
    if (broken.length) add('img-src', 'Image sources', 'fail', `${broken.length} images have an empty, relative or local source: they will not load in an inbox.`, broken.length)
    const words = textOf(body).split(' ').filter(Boolean).length
    if (words < 25 && imgs.length >= 1) add('image-only', 'Text and images', 'warn', `Little text (${words} words) next to ${imgs.length} images: image-only emails are blank with images off and look like spam to filters.`)
  }

  // ── Links ──
  const links = tags(body, 'a')
  if (links.length) {
    const empty = links.filter((t) => { const h = attr(t, 'href'); return h == null || !h.trim() || h.trim() === '#' })
    const insecure = links.filter((t) => /^http:\/\//i.test(attr(t, 'href') || ''))
    if (empty.length) add('links', 'Links', 'warn', `${empty.length} links go nowhere (no href, or "#").`, empty.length)
    else add('links', 'Links', 'pass', `${links.length} links, all with a target.`)
    if (insecure.length) add('https-link', 'Links over https', 'warn', `${insecure.length} links use http: browsers warn, and click tracking adds a redirect anyway.`, insecure.length)
  }

  // ── Layout ──
  const wide = [...body.matchAll(/\bwidth\s*=\s*["']?(\d{3,4})(?:px)?["']?|\bwidth\s*:\s*(\d{3,4})px/gi)].map((m) => Number(m[1] || m[2])).filter((w) => w > MOBILE_WIDTH)
  const hasMedia = /@media[^{]*max-width/i.test(body)
  if (wide.length && !hasMedia) add('width', 'Phone width', 'warn', `Fixed widths up to ${Math.max(...wide)}px and no @media rule for small screens: phones will scroll sideways or shrink the text.`)
  else if (wide.length) add('width', 'Phone width', 'info', `Fixed widths up to ${Math.max(...wide)}px, with @media rules for small screens. Check it with the Mobile preview.`)
  else add('width', 'Phone width', 'pass', `No fixed width over ${MOBILE_WIDTH}px.`)
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(body) && body.trim()) add('viewport', 'Viewport meta tag', 'info', 'No <meta name="viewport">: some phone mail apps zoom out. Content Builder templates usually have one.')

  // ── Size ──
  const bytes = new TextEncoder().encode(body).length
  if (bytes > GMAIL_CLIP) add('size', 'HTML size', 'warn', `${Math.round(bytes / 1024)} KB: Gmail cuts emails after about 102 KB and hides the rest, often the footer with the unsubscribe link. AMPscript and personalization change the sent size.`)
  else add('size', 'HTML size', 'pass', `${Math.round(bytes / 1024)} KB (Gmail clips at about 102 KB).`)

  // ── Things that cannot be judged here ──
  if (/%%\[|%%=|<script[^>]+runat\s*=\s*["']?server/i.test(body)) add('ampscript', 'AMPscript and SSJS', 'info', 'The email has AMPscript or server-side JavaScript: links, images and text it builds are not checked here. Use Preview with data or a test send.')

  const counts = { fail: 0, warn: 0, pass: 0, info: 0 }
  for (const c of checks) counts[c.level]++
  const order = { fail: 0, warn: 1, info: 2, pass: 3 }
  checks.sort((a, b) => order[a.level] - order[b.level])
  return { checks, counts }
}
