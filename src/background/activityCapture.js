// Version history of SQL Query and Script activities saved in Automation Studio
// (feedback #122). Helpers and record shape: utils/activityVersions.js.
//
// webRequest.onBeforeRequest for https://*.marketingcloudapps.com/AutomationStudioFuel3/*
// sees the save. The activity is read from SFMC straight away, before anything else is
// awaited, so the read usually reaches SFMC before the save lands: that is the
// version before the edit. If the save wins the race, the read returns the new text
// and only the saved version is kept (identical versions are never stored twice).
//
// Chrome gives no request body for PATCH (checked in Chromium 2026-10-24: PUT and POST
// have one, PATCH none). For a save without a readable body, the activity is read
// again once the save has completed (webRequest.onCompleted, activitySaveCompleted)
// and that is the saved version.

import { policyNow } from './policy.js'
import { storageGet, storageSet } from './chromeAsync.js'
import { sfmcFetch } from './fetchProxy.js'
import { fetchCurrentBusinessUnit } from './businessUnit.js'
import {
  ACTIVITY_SAVER_SETTING, ACTIVITY_MAX_SETTING, DEFAULT_MAX_VERSIONS,
  matchActivitySave, decodeRequestBody, pickActivity, addVersions, makeVersion, recordKey, activityUrl,
} from '../utils/activityVersions.js'

// One capture at a time per activity, so two quick saves keep their order.
const queues = {}
// The read before the save can hang while the app's session is started in a tab;
// after this long the saved version is stored without it.
export const captureTiming = { beforeReadMs: 10000 }

function withTimeout(promise, ms) {
  let timer
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => {
    console.warn('[Toolkit:SW] Reading the activity before its save took too long; keeping the saved version only.')
    resolve(null)
  }, ms) })]).finally(() => clearTimeout(timer))
}

// Saves without a readable body, by webRequest requestId, waiting for completion.
const pendingSaves = {}
export const completeTiming = { waitMs: 60000 }

function waitForCompletion(requestId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { delete pendingSaves[requestId]; resolve(false) }, completeTiming.waitMs)
    pendingSaves[requestId] = (ok) => { clearTimeout(timer); delete pendingSaves[requestId]; resolve(ok) }
  })
}

// webRequest.onCompleted / onErrorOccurred for the same URLs.
export function activitySaveCompleted(details) {
  const done = pendingSaves[details?.requestId]
  if (done) done(!details.error && details.statusCode >= 200 && details.statusCode < 300)
}

export function captureActivity(details) {
  const hit = matchActivitySave(details?.url, details?.method)
  if (!hit || policyNow().disableHistory) return
  const body = decodeRequestBody(details.requestBody)
  let saved = pickActivity(hit.kind, body)
  if (!saved && body) return // a body that holds no SQL or script: not a save of the text
  const url = activityUrl(hit.kind, hit.stack, hit.id)
  const savedLater = saved ? null : waitForCompletion(details.requestId).then((ok) => {
    if (!ok) return null
    return sfmcFetch({ url }).then((o) => pickActivity(hit.kind, o)).catch((e) => {
      console.warn('[Toolkit:SW] Could not read the activity after its save:', e?.message)
      return null
    })
  })
  const before = withTimeout(sfmcFetch({ url }).catch((e) => {
    console.warn('[Toolkit:SW] Could not read the activity before its save:', e?.message)
    return null
  }), captureTiming.beforeReadMs)
  const key = recordKey(hit.kind, hit.id)
  const savedAt = details.timeStamp || Date.now()
  const run = (queues[key] || Promise.resolve()).then(async () => {
    if (!saved) saved = await savedLater
    if (saved) await store(hit, key, saved, before, savedAt)
  })
  queues[key] = run.catch(() => {})
  return run
}

async function store(hit, key, saved, beforePromise, savedAt) {
  const prefs = await storageGet('local', [ACTIVITY_SAVER_SETTING, ACTIVITY_MAX_SETTING, key])
  if (prefs[ACTIVITY_SAVER_SETTING] !== true) return // off unless turned on (security review)
  const beforeObj = pickActivity(hit.kind, await beforePromise)
  const incoming = []
  if (beforeObj) incoming.push(makeVersion(beforeObj, { savedAt: savedAt - 1, source: 'before-save', stack: hit.stack }))
  incoming.push(makeVersion(saved, { savedAt, source: 'saved', stack: hit.stack }))

  const prev = prefs[key]
  const { versions, added } = addVersions(prev?.versions, incoming, prefs[ACTIVITY_MAX_SETTING] ?? DEFAULT_MAX_VERSIONS)
  if (!added) return
  const latest = versions[0]
  await storageSet('local', {
    [key]: {
      id: key,
      kind: hit.kind,
      activityId: hit.id,
      name: latest.name || prev?.name || '',
      key: latest.key || prev?.key || '',
      stack: hit.stack,
      businessUnit: prev?.businessUnit || null,
      timeStamp: prev?.timeStamp || savedAt,
      versions,
    },
  })
  console.info(`[Toolkit:SW] Saved ${added} version(s) of ${hit.kind} "${latest.name || hit.id}" (${key})`)
  if (!prev?.businessUnit) tagActivityBusinessUnit(key, hit.stack)
}

async function tagActivityBusinessUnit(key, stack) {
  try {
    const bu = await fetchCurrentBusinessUnit(stack)
    if (!bu) return
    const rec = (await storageGet('local', key))[key]
    if (!rec || rec.businessUnit?.name) return
    await storageSet('local', { [key]: { ...rec, businessUnit: bu } })
  } catch (e) {
    console.warn('[Toolkit:SW] Could not tag the business unit:', e?.message)
  }
}
