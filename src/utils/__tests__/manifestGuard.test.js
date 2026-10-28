// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { hostsIn, manifestSurface, diffSurface, currentSurface } from '../../../scripts/manifest-guard.mjs'
import baseline from '../../../security/manifest-baseline.json'

describe('manifest guard', () => {
  it('the code matches the committed baseline (update it on purpose with --update)', () => {
    expect(diffSurface(baseline, currentSurface())).toEqual([])
  })
  it('finds hosts in plain and template URLs', () => {
    expect([...hostsIn("fetch(`https://mc.${stack}.exacttarget.com/x`); 'https://evil.example.com/a'")].sort())
      .toEqual(['evil.example.com', 'mc.*.exacttarget.com'])
  })
  it('reports added and removed permissions and a changed CSP', () => {
    const a = manifestSurface({ permissions: ['storage'], content_security_policy: { extension_pages: "script-src 'self'" } })
    const b = manifestSurface({ permissions: ['storage', 'tabs'], content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" } })
    const d = diffSurface(a, b)
    expect(d[0]).toBe('permissions: added tabs')
    expect(d[1]).toMatch(/^content_security_policy: changed/)
  })
})
