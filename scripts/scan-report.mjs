// Writes security/scans/<version>.md for a release (used by .github/workflows/release.yml):
// the package's SHA-256 and the result of each scan, from the tools' JSON output.
//
//   node scripts/scan-report.mjs --version 2.0.18 --commit <sha> --zip <file> --dir <scan output dir>
//
// Expected in --dir (missing files are reported as "not run"): gitleaks.json,
// osv.json, retire.json, semgrep.json, audit.json, audit-share.json, guard.txt,
// tools.txt (tool versions, one per line).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return undefined } }

export function summarize(dir) {
  const p = (f) => join(dir, f)
  const rows = []
  const gl = readJson(p('gitleaks.json'))
  rows.push(['gitleaks (secrets, full history)', gl === undefined ? 'not run' : gl.length ? `**${gl.length} finding(s)**: ${gl.map((x) => `${x.RuleID} in ${x.File}:${x.StartLine}`).join('; ')}` : 'no findings'])
  const osv = readJson(p('osv.json'))
  const vulns = osv?.results?.flatMap((r) => r.packages?.flatMap((pk) => (pk.vulnerabilities || []).map((v) => `${pk.package?.name}@${pk.package?.version} ${v.id}`)) || []) || []
  rows.push(['osv-scanner (lockfiles)', osv === undefined ? 'not run' : vulns.length ? `${vulns.length} advisory(ies): ${vulns.join('; ')}` : 'no advisories'])
  const rj = readJson(p('retire.json'))
  const ret = (rj?.data || []).flatMap((f) => (f.results || []).filter((r) => r.vulnerabilities?.length).map((r) => `${r.component}@${r.version}`))
  rows.push(['retire.js (built package)', rj === undefined ? 'not run' : ret.length ? `**${ret.length} vulnerable library(ies)**: ${ret.join('; ')}` : 'no known-vulnerable libraries'])
  const sg = readJson(p('semgrep.json'))
  rows.push(['semgrep (p/javascript, p/secrets, p/xss, p/owasp-top-ten)', sg === undefined ? 'not run' : sg.results?.length ? `${sg.results.length} finding(s): ${sg.results.map((r) => `${r.check_id.split('.').pop()} ${r.path}:${r.start.line}`).join('; ')}` : 'no findings'])
  for (const [f, label] of [['audit.json', 'npm audit (extension)'], ['audit-share.json', 'npm audit (share worker)']]) {
    const a = readJson(p(f))
    const m = a?.metadata?.vulnerabilities
    rows.push([label, a === undefined ? 'not run' : m ? Object.entries(m).filter(([k, n]) => k !== 'total' && n).map(([k, n]) => `${n} ${k}`).join(', ') || '0 vulnerabilities' : 'unreadable'])
  }
  const guard = existsSync(p('guard.txt')) ? readFileSync(p('guard.txt'), 'utf8').trim() : 'not run'
  rows.push(['Manifest guard', guard])
  return rows
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = arg('--version')
  const commit = arg('--commit')
  const zip = arg('--zip')
  const dir = arg('--dir')
  const sha = createHash('sha256').update(readFileSync(zip)).digest('hex')
  const tools = existsSync(join(dir, 'tools.txt')) ? readFileSync(join(dir, 'tools.txt'), 'utf8').trim().split('\n').map((l) => `- ${l}`).join('\n') : '- (not recorded)'
  const md = `# Scans: Marketing Cloud Toolkit ${version}

Automated scans run by the release workflow. **Not an independent audit.**

- Tag: \`v${version}\`, commit \`${commit}\`
- Package: \`${zip.split('/').pop()}\`, ${statSync(zip).size.toLocaleString('en-US')} bytes
- **SHA-256: \`${sha}\`**
- Built with \`node scripts/package.mjs\` (reproducible: \`npm ci\`, commit timestamp, sorted files)

| Check | Result |
|---|---|
${summarize(dir).map(([a, b]) => `| ${a} | ${String(b).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`).join('\n')}

Tools:
${tools}

## Published package check

To be filled after the Chrome Web Store publishes this version: download the published CRX, unpack it and compare it with the zip above (\`docs/release-process.md\`).
`
  const out = join(root, 'security/scans', `${version}.md`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, md)
  console.log(`Wrote security/scans/${version}.md (SHA-256 ${sha})`)
}
