// The business unit the user is in, for the BU badge on saved queries and the top bar.
// The id field is assumed to be `accountId` (falls back to `id`/`memberId`); not yet
// confirmed against a live response.

import { coreOrigin } from '../utils/sfmcHosts.js'

const cache = {} // { [stack]: { ts, bu } }
const TTL = 60 * 1000

export function toBusinessUnit(d) {
  if (!d?.name) return null
  return { name: d.name, accountId: d.accountId ?? d.id ?? d.memberId ?? null }
}

/** Forgets the cached unit (SFMC switched business unit). */
export function clearCurrentBusinessUnit(stack) {
  if (stack) delete cache[stack]
  else for (const k of Object.keys(cache)) delete cache[k]
}

export async function fetchCurrentBusinessUnit(stack) {
  const hit = cache[stack]
  if (hit && Date.now() - hit.ts < TTL) return hit.bu
  const res = await fetch(`${coreOrigin(stack)}/cloud/fuelapi/platform-internal/v1/accounts/@current`,
    { credentials: 'include', redirect: 'manual' })
  if (res.status !== 200) return null
  const bu = toBusinessUnit(await res.json())
  cache[stack] = { ts: Date.now(), bu }
  return bu
}
