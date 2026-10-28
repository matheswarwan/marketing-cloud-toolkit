// Reproducible package (security review, 2026-10-28): builds dist/ and zips it so the
// same commit always gives the same bytes, then prints the zip's SHA-256.
//
//   node scripts/package.mjs [--ci] [--out <file>] [--force]
//
// --ci      run `npm ci` first (clean install from package-lock.json, as the release
//           workflow does)
// --out     where to write the zip (default releases/sfmc-toolkit-<version>.zip)
// --force   overwrite an existing zip (never done by default: published zips stay)
//
// Reproducible because: dependencies come from the lockfile, every file gets the
// commit's timestamp (SOURCE_DATE_EPOCH), files are added in sorted order, and zip
// stores no extra attributes (-X) or directory entries (-D). Needs `zip` (Info-ZIP).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString().trim()

export function listFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name !== '.DS_Store') out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // byte order, not locale order
}

export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8')).version
  const commit = run('git', ['rev-parse', '--short', 'HEAD'])
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']) !== ''
  const epoch = Number(process.env.SOURCE_DATE_EPOCH || run('git', ['log', '-1', '--format=%ct']))
  const out = resolve(root, option('--out') || `releases/sfmc-toolkit-${version}.zip`)
  if (existsSync(out) && !flag('--force')) {
    console.error(`${relative(root, out)} exists. Published zips are never overwritten; pass --out <file> or --force.`)
    process.exit(1)
  }
  if (dirty) console.warn('Warning: the working tree has uncommitted changes, so this zip does not match a commit.')

  if (flag('--ci')) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' })
  rmSync(join(root, 'dist'), { recursive: true, force: true })
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch) } })

  const dist = join(root, 'dist')
  const files = listFiles(dist)
  for (const f of files) utimesSync(join(dist, f), epoch, epoch)
  mkdirSync(dirname(out), { recursive: true })
  rmSync(out, { force: true })
  execFileSync('zip', ['-X', '-D', '-q', out, '-@'], { cwd: dist, input: files.join('\n') + '\n', stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, TZ: 'UTC' } })

  const hash = sha256File(out)
  console.log(`Marketing Cloud Toolkit ${version}, commit ${commit}${dirty ? ' (uncommitted changes)' : ''}`)
  console.log(`${relative(root, out)}: ${statSync(out).size.toLocaleString('en-US')} bytes, ${files.length} files`)
  console.log(`SHA-256 ${hash}`)
}
