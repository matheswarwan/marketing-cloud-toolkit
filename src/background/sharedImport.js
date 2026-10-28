// IMPORT_SHARED_QUERY (share-handler.js): accepts only a message from a share page,
// with one sql_<digits> record, and keeps only the fields a saved query has.
export const SHARE_PAGE_PREFIX = 'https://sfmc-share-worker.mathes-btech.workers.dev/share/'

export function sharedQueryRecords(records, senderUrl) {
  if (!String(senderUrl || '').startsWith(SHARE_PAGE_PREFIX)) return null
  const entries = Object.entries(records || {})
  if (entries.length !== 1) return null
  const [id, r] = entries[0]
  if (!/^sql_\d+$/.test(id) || !r || typeof r.queryText !== 'string' || !r.queryText.trim() || r.queryText.length > 100000) return null
  const timeStamp = Number(id.slice(4))
  return {
    [id]: {
      id,
      queryText: r.queryText,
      timeStamp,
      url: String(senderUrl).split(/[?#]/)[0],
      name: String(r.name || '').slice(0, 200) || new Date(timeStamp).toDateString(),
      isFavourite: false,
    },
  }
}
