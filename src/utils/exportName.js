// File names for downloads (feedback #39): <business unit>_<what>_<date>_<time>,
// for example Northwind_data-extensions-orders_2026-10-20_0553.md.
import { fetchCurrentBU } from './sfmcApi.js'
import { safeFileName } from './exportDoc.js'

const BU_TTL = 5 * 60 * 1000
const buNames = new Map() // stack -> { name, at }

async function buName(stack) {
  if (!stack) return ''
  const hit = buNames.get(stack)
  if (hit && Date.now() - hit.at < BU_TTL) return hit.name
  try {
    const bu = await fetchCurrentBU(stack)
    const name = bu?.name || stack
    buNames.set(stack, { name, at: Date.now() })
    return name
  } catch {
    return stack
  }
}

export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** File name without extension; the business unit is left out when unknown. */
export async function exportBaseName(stack, what, now = new Date()) {
  const bu = await buName(stack)
  return [bu, what, fileStamp(now)].filter(Boolean).map((s) => safeFileName(s)).join('_')
}
