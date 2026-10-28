// PRIVACY.md is the one source of the privacy policy. This renders it to
//   public/privacy.html       bundled in the extension (linked from Settings, Share and Feedback)
//   site/public/privacy.html  the hosted copy (marketing-cloud-toolkit.mathes.dev/privacy)
// Run by `npm run build`; `npm test` fails when either file is out of date.
// Only the Markdown PRIVACY.md uses: # and ## headings, paragraphs, "- " lists, **bold**,
// `code` and [links](url).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

export function renderPrivacy(md) {
  const out = []
  let title = ''
  let list = null
  let para = []
  const flushPara = () => { if (para.length) { out.push(`  <p>${inline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => { if (list) { out.push('  <ul>', ...list.map((li) => `    <li>${inline(li)}</li>`), '  </ul>'); list = null } }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) { flushPara(); flushList(); title = line.slice(2); out.push(`  <h1>${inline(title)}</h1>`) }
    else if (line.startsWith('## ')) { flushPara(); flushList(); out.push(`  <h2>${inline(line.slice(3))}</h2>`) }
    else if (line.startsWith('- ')) { flushPara(); (list ||= []).push(line.slice(2)) }
    else if (!line.trim()) { flushPara(); flushList() }
    else if (list) list[list.length - 1] += ` ${line.trim()}`
    else para.push(line.trim())
  }
  flushPara()
  flushList()
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1f2b; --muted: #5b6475; --bg: #ffffff; --line: #e3e6ec; --link: #0b5cab; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8eaee; --muted: #a2a9b6; --bg: #12151c; --line: #2a2f3a; --link: #78b0fd; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  li { margin: 0.25rem 0; }
  a { color: var(--link); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
</style>
</head>
<body>
<main>
${out.join('\n')}
</main>
</body>
</html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url)
  const html = renderPrivacy(readFileSync(new URL('PRIVACY.md', root), 'utf8'))
  for (const target of ['public/privacy.html', 'site/public/privacy.html']) writeFileSync(new URL(target, root), html)
  console.log('privacy.html written from PRIVACY.md')
}
