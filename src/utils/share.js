// Share a query (security review, 2026-10-28). Sharing sends the query's name and SQL
// to the share service (workers/share), which keeps them for 24 hours and shows them
// to anyone who opens the link. Off unless the user turns it on in Settings, never
// when the admin policy disableShare is on, and every share is confirmed in
// ShareQueryDialog with the exact text that will be sent. Nothing else is sent: no
// results, no SFMC names, no account details.
import { policy } from './policy.js'

export const SHARE_ENDPOINT = 'https://sfmc-share-worker.mathes-btech.workers.dev/api/share'
export const SHARE_SETTING = '_shareEnabled'
export const MAX_SHARE_SQL = 100_000
export const MAX_SHARE_NAME = 200

/** Sharing is offered when the user turned it on and no policy turns it off. */
export const shareAllowed = (setting) => setting === true && !policy.disableShare

/** Exactly what is sent. */
export function sharePayload(name, sql) {
  return { name: String(name || 'Untitled Query').slice(0, MAX_SHARE_NAME), queryText: String(sql || '') }
}

/** Things in the SQL that look like personal data, for the warning: e-mail addresses and phone-like numbers. */
export function personalDataHints(sql) {
  const s = String(sql || '')
  const hints = []
  const emails = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  if (emails.length) hints.push(`${emails.length} e-mail address${emails.length === 1 ? '' : 'es'}`)
  const phones = s.match(/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g) || []
  if (phones.length) hints.push(`${phones.length} phone-like number${phones.length === 1 ? '' : 's'}`)
  return hints
}

export async function createShareLink(payload, fetchImpl = fetch) {
  if (policy.disableShare) throw new Error('Sharing is turned off by your organization\'s policy.')
  if (!payload.queryText.trim()) throw new Error('There is no SQL to share.')
  if (payload.queryText.length > MAX_SHARE_SQL) throw new Error(`The SQL is longer than ${MAX_SHARE_SQL.toLocaleString()} characters.`)
  const res = await fetchImpl(SHARE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`The share service answered ${res.status}.`)
  const data = await res.json()
  if (!data?.url) throw new Error('The share service sent no link.')
  return data.url
}
