// Saving Query Studio runs as queries (Query Studio 1 and 2, both apps on Heroku that
// send the SQL as `querytext` in POST /query/create). Off unless turned on in Settings
// (security review, 2026-10-28): turning it on asks Chrome for the optional host
// permission QUERY_STUDIO_PERMISSION, turning it off gives it back. Chrome cannot
// match "querystudio2-*" (feedback #1014: the Query Studio 2 host name has a deployment
// id in it that can change), so the permission is *.herokuapp.com and the capture
// itself only accepts querystudio* hosts.
export const QUERY_STUDIO_SETTING = '_saveQueryStudio'

export const QUERY_STUDIO_PERMISSION = { origins: ['https://*.herokuapp.com/*'] }

// webRequest filter. Chrome delivers these only while the permission is granted.
export const QUERY_STUDIO_CREATE_URLS = ['https://*.herokuapp.com/query/create']

/** True for Query Studio's own hosts: querystudio.herokuapp.com, querystudio2-<id>.herokuapp.com. */
export function isQueryStudioUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /^querystudio[a-z0-9-]*\.herokuapp\.com$/i.test(u.hostname)
  } catch {
    return false
  }
}
