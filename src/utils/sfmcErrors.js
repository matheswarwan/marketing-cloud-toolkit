// Connection errors on search pages (feedback #93). When an SFMC app has no session
// (no token, its login page instead of data), a search used to come back empty.
// `withReconnect` starts that app's session once (as Connect in the connection menu
// does) and tries again; `searchError` turns what is left into a message that names
// the app, for SfmcErrorNotice (Retry, and a link to open the app in SFMC).
import { sendToBackground } from './messaging.js'

export const CONNECTION_CODES = new Set(['SFMC_LOGIN_REQUIRED', 'SFMC_SESSION_UNAVAILABLE'])

export function isConnectionError(e) {
  return !!e && (CONNECTION_CODES.has(e.code) || e.status === 401)
}

/** Runs `fn`; on a connection error, starts the app's session once and runs it again. */
export async function withReconnect(stack, fn, { send = sendToBackground } = {}) {
  try {
    return await fn()
  } catch (e) {
    if (!isConnectionError(e) || !stack || !e.app?.id) throw e
    const r = await send({ type: 'SFMC_CONNECT_APP', stack, appId: e.app.id })
    if (!r || r.error) {
      if (r?.error) e.message = r.error
      throw e
    }
    return fn()
  }
}

/**
 * What a page shows for a failed search: { message, connection, appName, appUrl }.
 * `what` completes "Could not ..." for other errors ("search automations").
 */
export function searchError(e, what) {
  const reason = String(e?.message || e || 'unknown error')
  if (isConnectionError(e)) {
    const name = e.app?.name || 'Marketing Cloud'
    return { message: `Could not connect to ${name}: ${reason}`, connection: true, appName: name, appUrl: e.app?.url || null }
  }
  return { message: `Could not ${what}: ${reason}`, connection: false, appName: null, appUrl: null }
}
