// Manifest guard (security review, Phase 5). Fails when the extension's reach changes
// compared with security/manifest-baseline.json: permissions, host permissions, content
// script matches and files, the CSP, externally_connectable, web_accessible_resources,
// managed storage, or a network host named in the shipped source. A change is only
// accepted by updating the baseline in its own reviewed commit:
//
//   node scripts/manifest-guard.mjs            check (CI)
//   node scripts/manifest-guard.mjs --update   rewrite the baseline from the current code
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(root, 'security/manifest-baseline.json')
// Shipped code (the extension) and the two services; tests are left out.
const SOURCE_DIRS = ['src', 'public', 'workers/share/src', 'workers/feedback']
const SOURCE_EXT = /\.(js|mjs|vue|html|json)$/
const SKIP = /(__tests__|\.test\.js$|node_modules|privacy\.html$|managed_schema\.json$)/

const sorted = (a) => [...new Set(a || [])].sort()

/** The parts of the manifest that decide what the extension can reach. */
export function manifestSurface(m) {
  return {
    permissions: sorted(m.permissions),
    optional_permissions: sorted(m.optional_permissions),
    host_permissions: sorted(m.host_permissions),
    optional_host_permissions: sorted(m.optional_host_permissions),
    content_security_policy: m.content_security_policy ?? null,
    content_scripts: (m.content_scripts || []).map((c) => ({ matches: sorted(c.matches), js: c.js || [], run_at: c.run_at || 'document_idle', all_frames: !!c.all_frames })),
    externally_connectable: m.externally_connectable ?? null,
    web_accessible_resources: m.web_accessible_resources ?? null,
    managed_schema: m.storage?.managed_schema ?? null,
  }
}

/** Hosts named in URLs in `text`; template parts like ${stack} become *. */
export function hostsIn(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/https?:\/\/((?:[A-Za-z0-9-]+|\$\{[^}]+\}|\*)(?:\.(?:[A-Za-z0-9-]+|\$\{[^}]+\}|\*))+)/g)) {
    const host = m[1].replace(/\$\{[^}]+\}/g, '*').toLowerCase()
    if (/\.[a-z]{2,}$/.test(host)) out.add(host)
  }
  return out
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.test(p)) continue
    if (statSync(p).isDirectory()) walk(p, files)
    else if (SOURCE_EXT.test(name)) files.push(p)
  }
  return files
}

export function sourceHosts() {
  const hosts = new Set()
  for (const d of SOURCE_DIRS) for (const f of walk(join(root, d))) for (const h of hostsIn(readFileSync(f, 'utf8'))) hosts.add(h)
  return sorted([...hosts])
}

export function currentSurface() {
  const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'))
  return { ...manifestSurface(manifest), sourceHosts: sourceHosts() }
}

/** Differences as readable lines ([] when equal). */
export function diffSurface(baseline, current) {
  const lines = []
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const a = baseline[key]
    const b = current[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    if (Array.isArray(a) && Array.isArray(b) && a.every((x) => typeof x === 'string') && b.every((x) => typeof x === 'string')) {
      for (const x of b) if (!a.includes(x)) lines.push(`${key}: added ${x}`)
      for (const x of a) if (!b.includes(x)) lines.push(`${key}: removed ${x}`)
    } else {
      lines.push(`${key}: changed\n  baseline: ${JSON.stringify(a)}\n  now:      ${JSON.stringify(b)}`)
    }
  }
  return lines
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = currentSurface()
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
    console.log(`Wrote ${relative(root, BASELINE)}. Commit it on its own, with the reason, for review.`)
    process.exit(0)
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const diff = diffSurface(baseline, current)
  if (diff.length) {
    console.error('Manifest guard: the extension\'s reach changed compared with security/manifest-baseline.json:\n')
    for (const l of diff) console.error(`- ${l}`)
    console.error('\nIf intended, run `node scripts/manifest-guard.mjs --update` and commit the baseline on its own with the reason.')
    process.exit(1)
  }
  console.log(`Manifest guard: OK (${current.permissions.length} permissions, ${current.host_permissions.length} hosts, ${current.sourceHosts.length} source hosts).`)
}
