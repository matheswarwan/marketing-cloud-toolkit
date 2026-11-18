// npm audit that fails on moderate, high and critical advisories (as `npm audit
// --audit-level=moderate` did), except the reviewed ones in osv-scanner.toml (one list for both
// scanners; reasons there and in docs/security-summary.md). An entry with ignoreUntil fails again
// after that date.
// Usage: node scripts/audit.mjs [audit.json]   (reads `npm audit --json` from the file, or runs it
// in the current directory, so `cd workers/share && node ../../scripts/audit.mjs` checks the worker)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LEVELS = ['moderate', 'high', 'critical']
const today = new Date().toISOString().slice(0, 10)
const ignored = new Set(
  readFileSync(new URL('../osv-scanner.toml', import.meta.url), 'utf8')
    .split(/^\[\[IgnoredVulns\]\]/m).slice(1)
    .map((b) => ({ id: b.match(/^id\s*=\s*"([^"]+)"/m)?.[1], until: b.match(/^ignoreUntil\s*=\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] }))
    .filter((e) => e.id && (!e.until || today <= e.until))
    .map((e) => e.id),
)

let raw
if (process.argv[2]) raw = readFileSync(process.argv[2], 'utf8')
else {
  try { raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }) } catch (e) { raw = e.stdout } // npm audit exits 1 when it finds anything
}
const report = JSON.parse(raw)
if (report.error) { console.error('npm audit failed:', report.error.summary || report.error); process.exit(2) }

// Every vulnerable package traces back to an advisory object in some `via`; packages that only
// depend on a vulnerable one list names, not advisories. So checking the advisories is enough.
const ghsa = (url = '') => (url.match(/GHSA-[\w-]+/) || [])[0] || ''
const seen = new Map()
for (const v of Object.values(report.vulnerabilities || {})) {
  for (const a of v.via) if (typeof a === 'object' && LEVELS.includes(a.severity)) seen.set(a.url || a.title, a)
}
const failing = [...seen.values()].filter((a) => !ignored.has(ghsa(a.url)))
const skipped = [...seen.values()].filter((a) => ignored.has(ghsa(a.url)))
for (const a of skipped) console.log(`reviewed, skipped: ${ghsa(a.url)} ${a.name} (${a.severity}) ${a.title}`)
for (const a of failing) console.log(`FAIL: ${a.severity} ${a.name}: ${a.title} ${a.url}`)
console.log(failing.length ? `${failing.length} moderate or worse advisories.` : 'No moderate or worse advisories outside the reviewed list.')
process.exit(failing.length ? 1 : 0)
