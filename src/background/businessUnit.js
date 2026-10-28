// The business unit the user is in, for the BU badge on saved queries and the top bar.
// The id field is assumed to be `accountId` (falls back to `id`/`memberId`); not yet
// confirmed against a live response.

const cache = {} // { [stack]: { ts, bu } }
const TTL = 60 * 1000

export function toBusinessUnit(d) {
  if (!d?.name) return null
  return { name: d.name, accountId: d.accountId ?? d.id ?? d.memberId ?? null }
}

export async function fetchCurrentBusinessUnit(stack) {
  const hit = cache[stack]
  if (hit && Date.now() - hit.ts < TTL) return hit.bu
  const res = await fetch(`https://mc.${stack}.exacttarget.com/cloud/fuelapi/platform-internal/v1/accounts/@current`,
    { credentials: 'include', redirect: 'manual' })
  if (res.status !== 200) return null
  const bu = toBusinessUnit(await res.json())
  cache[stack] = { ts: Date.now(), bu }
  return bu
}
