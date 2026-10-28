// Saving records: queries run in Query Studio, emails saved in Content Builder, and
// records sent by the app pages (Add query, rename, shared-query import).
//
// Storage keys and shapes are SFMC Query Saver's (`sql_<ts>`, `email_<assetId>`), so
// a Query Saver backup imports unchanged.

import { getPolicy } from './policy.js'
import { makeRoom, EMAIL_MAX_VERSIONS } from './storageRoom.js'
import { storageGet, storageSet, delay } from './chromeAsync.js'
import { resolveStack } from './stack.js'
import { fetchCurrentBusinessUnit } from './businessUnit.js'
import { QUERY_STUDIO_SETTING, isQueryStudioUrl } from '../utils/queryStudio.js'

const decoder = new TextDecoder('utf-8')

async function blinkIcon() {
  try {
    chrome.action.setIcon({ path: '/images/icon48x48-off.png' })
    await delay(5000)
    chrome.action.setIcon({ path: '/images/icon48x48.png' })
  } catch { /* no action API in tests */ }
}

export async function saveRecords(records) {
  blinkIcon()
  await storageSet('local', records)
}

export async function renameQuery(id, name) {
  const rec = (await storageGet('local', id))[id]
  if (rec) await storageSet('local', { [id]: { ...rec, name } })
}

// Adds { name, accountId } of the current business unit to a saved query, after it
// is saved, so a failed lookup never loses the query.
export async function tagBusinessUnit(id) {
  try {
    const { stack } = await resolveStack()
    if (!stack) return
    const bu = await fetchCurrentBusinessUnit(stack)
    if (!bu) return
    const rec = (await storageGet('local', id))[id]
    if (!rec || rec.businessUnit?.name) return
    await storageSet('local', { [id]: { ...rec, businessUnit: { ...(rec.businessUnit || {}), ...bu } } })
  } catch (e) {
    console.warn('[Toolkit:SW] Could not tag the business unit:', e?.message)
  }
}

// webRequest.onBeforeRequest for POST /query/create in Query Studio 1 and 2
// (QUERY_STUDIO_CREATE_URLS in utils/queryStudio.js)
export async function captureQueryStudio(details) {
  if (details.method !== 'POST' || !details.requestBody?.raw?.[0]?.bytes || !isQueryStudioUrl(details.url)) return
  if ((await getPolicy()).disableHistory) return
  // Off unless the user turned it on (Settings > Running queries).
  if ((await storageGet('local', [QUERY_STUDIO_SETTING]))[QUERY_STUDIO_SETTING] !== true) return
  let queryText
  try {
    queryText = JSON.parse(decoder.decode(new Uint8Array(details.requestBody.raw[0].bytes))).querytext
  } catch {
    return
  }
  if (!queryText) return
  const ts = details.timeStamp
  const id = 'sql_' + ts
  await saveRecords({
    [id]: {
      id,
      queryText,
      timeStamp: ts,
      url: details.url,
      name: new Date(ts).toDateString() + ' ' + new Date(ts).toLocaleTimeString(),
      isFavourite: false,
    },
  })
  await tagBusinessUnit(id)
}

// ── Content Builder email versions ─────────────────────────
// Saved Emails is off unless the user turns it on (security review, 2026-10-28).
export const emailSaver = { enabled: false, debounceMs: 5000 }
const lastSavedAt = {}

export async function loadEmailSaverPrefs() {
  const prefs = await storageGet('local', ['_emailSaverEnabled', '_emailSaveDebounce'])
  applyEmailSaverPrefs(prefs)
}

export function applyEmailSaverPrefs(prefs) {
  if ('_emailSaverEnabled' in prefs) emailSaver.enabled = prefs._emailSaverEnabled === true
  if ('_emailSaveDebounce' in prefs) {
    const s = prefs._emailSaveDebounce
    emailSaver.debounceMs = typeof s === 'number' && s >= 0 ? s * 1000 : 5000
  }
}

function pickView(view) {
  if (!view) return null
  return {
    content: view.content || null,
    superContent: view.superContent || null,
    design: view.design || null,
    slots: view.slots || null,
    blocks: view.blocks || null,
  }
}

// webRequest.onBeforeRequest for https://*.marketingcloudapps.com/fuelapi/asset/v1/content/assets/*
export async function captureEmail(details) {
  if (!emailSaver.enabled || details.method !== 'PUT') return
  if ((await getPolicy()).disableHistory) return
  if (!details.requestBody?.raw?.[0]?.bytes) return
  let jsonStr, asset
  try {
    jsonStr = decoder.decode(new Uint8Array(details.requestBody.raw[0].bytes))
    asset = JSON.parse(jsonStr)
  } catch {
    return
  }
  if (!(asset.assetType?.name || '').toLowerCase().includes('email')) return

  const assetId = asset.id || Number(details.url.split('/').pop())
  const now = Date.now()
  if (emailSaver.debounceMs > 0 && now - (lastSavedAt[assetId] || 0) < emailSaver.debounceMs) return
  lastSavedAt[assetId] = now

  const key = `email_${assetId}`
  const stack = details.url.match(/content-builder\.([^.]+)\.marketingcloudapps\.com/)?.[1] || null
  const compileAsset = {
    superContent: asset.superContent || null,
    content: asset.content || null,
    design: asset.design || null,
    slots: asset.slots || null,
    blocks: asset.blocks || null,
    views: { html: pickView(asset.views?.html) },
  }
  // What a revert PUTs back: the asset as saved, minus the thumbnail and other views.
  const assetBody = JSON.parse(jsonStr)
  if (assetBody.views) {
    assetBody.views = {
      ...(asset.views.subjectline ? { subjectline: asset.views.subjectline } : {}),
      ...(asset.views.preheader ? { preheader: asset.views.preheader } : {}),
      ...(asset.views.html ? { html: asset.views.html } : {}),
    }
  }
  delete assetBody.thumbnail

  const subject = asset.views?.subjectline?.content || ''
  const version = {
    versionId: `v_${now}`,
    savedAt: now,
    subject,
    name: asset.name || `Email ${assetId}`,
    status: asset.status?.name || 'Draft',
    categoryName: asset.category?.name || '',
    compileAsset,
    assetBody,
    stack,
  }
  await makeRoom(JSON.stringify(version).length)
  const prev = (await storageGet('local', key))[key]
  await saveRecords({
    [key]: {
      id: key,
      assetId: Number(assetId),
      customerKey: asset.customerKey || '',
      name: asset.name || `Email ${assetId}`,
      assetTypeName: asset.assetType?.name || '',
      assetTypeDisplayName: asset.assetType?.displayName || '',
      status: asset.status?.name || 'Draft',
      categoryId: asset.category?.id || null,
      categoryName: asset.category?.name || '',
      subject,
      compileAsset,
      ownerName: asset.owner?.name || '',
      ownerEmail: asset.owner?.email || '',
      memberId: asset.memberId || null,
      enterpriseId: asset.enterpriseId || null,
      createdDate: asset.createdDate || null,
      modifiedDate: asset.modifiedDate || null,
      isFavourite: prev?.isFavourite || false,
      timeStamp: prev?.timeStamp || now,
      versions: [version, ...(Array.isArray(prev?.versions) ? prev.versions : [])].slice(0, EMAIL_MAX_VERSIONS),
    },
  })
}
