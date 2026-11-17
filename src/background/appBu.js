// Apps whose session stays in the business unit it started in (user, 2026-11-17).
//
// Checked live on s10 that day: after switching business unit in SFMC, Automation Studio,
// Contact Builder and CloudPages answered for the new unit, but Content Builder stayed in
// the unit of its last sign-in and Journey Builder in the unit the user logged in to, so
// the Toolkit read another unit's emails and journeys without any error (an email of the
// new unit came back 404). Signing the app in again through its SSO.aspx landing moves it
// to the current unit.
//
// So before a call to such an app (`followsBusinessUnit: false` in apps.js), its unit (its
// platform/v1/tokenContext `organization.id`) is compared with SFMC's (core
// accounts/@current `accountId`); when they differ, the landing is opened in an inactive
// tab until the app reports the current unit. A unit switch in SFMC (the shell loads
// /cloud/context-switch.html) clears what is known, so the next call checks again.

import { createTab, removeTab, delay } from './chromeAsync.js'

export const buTiming = { pollMs: 1000, timeoutMs: 20000, checkEveryMs: 60000 }

const known = new Map() // `${stack}:${appId}` → { mid, at }
const inFlight = new Map() // `${stack}:${appId}` → Promise

/** A unit switch in SFMC: every app is checked again on its next call. */
export function forgetAppUnits(stack) {
  for (const k of [...known.keys()]) if (!stack || k.startsWith(`${stack}:`)) known.delete(k)
}

const CONTEXT_SWITCH = /^https:\/\/mc\.([a-z0-9]+)\.exacttarget\.com\/cloud\/context-switch\.html/i

/** webRequest.onBeforeRequest on exacttarget.com: the shell switching business unit. */
export function noteContextSwitch(details, onSwitch = forgetAppUnits) {
  const m = CONTEXT_SWITCH.exec(String(details?.url || ''))
  if (m) onSwitch(m[1].toLowerCase())
}

/**
 * Makes sure `app` answers for the current business unit before a call.
 * deps: currentMid(stack) → number|null (SFMC's unit), appMid(app, stack) → number|null
 * (the app's unit, null when unknown). Never throws: a failed check leaves the call as is.
 * @returns {Promise<'skip'|'same'|'moved'|'unknown'|'failed'>}
 */
export function ensureAppInCurrentUnit(app, stack, { currentMid, appMid, now = Date.now }) {
  if (!app || app.followsBusinessUnit !== false || !stack || !app.landings) return Promise.resolve('skip')
  const key = `${stack}:${app.id}`
  if (inFlight.has(key)) return inFlight.get(key)
  const promise = (async () => {
    const want = await currentMid(stack).catch(() => null)
    if (!want) return 'unknown'
    const last = known.get(key)
    if (last && last.mid === want && now() - last.at < buTiming.checkEveryMs) return 'same'
    const have = await appMid(app, stack).catch(() => null)
    if (have === want) { known.set(key, { mid: want, at: now() }); return 'same' }
    // No unit (no session yet): the usual 401 handling starts one, in the current unit.
    if (have == null) return 'unknown'
    const landing = app.landings(stack).find((u) => u.includes('/cloud/tools/SSO.aspx'))
    if (!landing) return 'failed'
    const tab = await createTab({ url: landing, active: false })
    if (!tab) return 'failed'
    try {
      const deadline = now() + buTiming.timeoutMs
      while (now() < deadline) {
        await delay(buTiming.pollMs)
        if (await appMid(app, stack).catch(() => null) === want) { known.set(key, { mid: want, at: now() }); return 'moved' }
      }
      console.warn(`[Toolkit:SW] ${app.name} stayed in another business unit on ${stack}`)
      return 'failed'
    } finally {
      removeTab(tab.id)
    }
  })().finally(() => { inFlight.delete(key) })
  inFlight.set(key, promise)
  return promise
}
