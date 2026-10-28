// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderPrivacy } from '../../../scripts/build-privacy.mjs'

const root = new URL('../../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

describe('privacy policy (PRIVACY.md is the one source)', () => {
  it('the bundled and hosted pages match PRIVACY.md (run npm run privacy)', () => {
    const html = renderPrivacy(read('PRIVACY.md'))
    expect(read('public/privacy.html')).toBe(html)
    expect(read('site/public/privacy.html')).toBe(html)
  })
  it('names the current publisher, not a former one', () => {
    const md = read('PRIVACY.md')
    expect(md).toContain('Matheswaran Kanagarajan')
    expect(md).not.toMatch(/cloudkettle|ateko/i)
  })
})
