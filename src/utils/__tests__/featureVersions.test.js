import { describe, it, expect } from 'vitest'
import { compareVersions, featureVersions, featuresSince } from '../featureVersions.js'

const GROUPS = [
  { id: 'a', title: 'A', items: [{ title: 'old' }, { title: 'x', since: '2.0.9' }, { title: 'y', since: '2.0.24' }] },
  { id: 'b', title: 'B', items: [{ title: 'z', since: '2.0.10' }, { title: 'next', since: '2.0.25' }] },
]

describe('feature versions', () => {
  it('compares numerically', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.9', '2.0.9')).toBe(0)
    expect(compareVersions('2.0', '2.0.1')).toBeLessThan(0)
  })
  it('lists versions newest first, none above the build', () => {
    expect(featureVersions(GROUPS)).toEqual(['2.0.25', '2.0.24', '2.0.10', '2.0.9'])
    expect(featureVersions(GROUPS, '2.0.24')).toEqual(['2.0.24', '2.0.10', '2.0.9'])
  })
  it('keeps features new since a version, up to the build', () => {
    const r = featuresSince(GROUPS, '2.0.10', '2.0.24')
    expect(r.map((g) => g.items.map((f) => f.title))).toEqual([['y'], ['z']])
    expect(featuresSince(GROUPS, '')).toBe(GROUPS)
    expect(featuresSince(GROUPS, '2.0.24')).toHaveLength(2)
  })
})
