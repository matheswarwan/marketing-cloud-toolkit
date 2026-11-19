// Features page filter by version (feedback #1107).

/** Compares dotted versions numerically: '2.0.10' > '2.0.9'. */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

/** The versions features are marked new in, newest first, none above `upTo` when given. */
export function featureVersions(groups, upTo = '') {
  const set = new Set()
  for (const g of groups) for (const f of g.items) if (f.since) set.add(f.since)
  return [...set].filter((v) => !upTo || compareVersions(v, upTo) <= 0).sort((a, b) => compareVersions(b, a))
}

/**
 * Groups with only the features new in `since` or later, and not above `upTo` when
 * given (all groups when `since` is empty).
 */
export function featuresSince(groups, since, upTo = '') {
  if (!since) return groups
  const keep = (f) => f.since && compareVersions(f.since, since) >= 0 && (!upTo || compareVersions(f.since, upTo) <= 0)
  return groups
    .map((g) => ({ ...g, items: g.items.filter(keep) }))
    .filter((g) => g.items.length)
}
