// What Ctrl+K lists for a search text: sections, saved queries and emails that match,
// and "search this in <section>" actions for the SFMC sections.

// `when(text)`: only offered when it says so (a JobID is a number); `query`: extras for the page.
export const SEARCH_ACTIONS = [
  { path: '/data-extensions', label: 'Data Extensions' },
  { path: '/automations', label: 'Automations' },
  { path: '/activities', label: 'Query activities' },
  { path: '/journeys', label: 'Journeys' },
  { path: '/journey-entry', label: 'Journey entry events' },
  { path: '/cloudpages', label: 'CloudPages' },
  // User, 2026-11-16 (idea from VeLens's palette): emails, content blocks, subscribers, sends.
  { path: '/emails', label: 'Emails' },
  { path: '/where-used', label: 'Content blocks (Where used)', query: { kind: 'block' } },
  { path: '/where-used', label: 'Where a data extension is used', query: { kind: 'de' } },
  { path: '/subscribers', label: 'Subscribers' },
  { path: '/sends', label: 'Sends by JobID', when: (t) => /^\d+$/.test(t) },
  { path: '/queries/starter', label: 'Starter queries' },
]

const MAX_RECORDS = 8

/**
 * @param {string} text
 * @param {Array<{path, name, group, icon?}>} sections
 * @param {object} storage  chrome.storage.local contents
 * @returns {Array<{ kind, label, hint, to, icon? }>}
 */
export function paletteEntries(text, sections, storage = {}) {
  const q = text.trim().toLowerCase()
  const matches = (...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q))

  const out = sections.filter((s) => matches(s.name, s.group))
    .map((s) => ({ kind: 'section', label: s.name, hint: s.group, to: { path: s.path }, icon: s.icon }))
  if (!q) return out

  const records = Object.entries(storage)
  const queries = records
    .filter(([k, v]) => k.startsWith('sql_') && typeof v?.queryText === 'string' && (v.queryText.trim() || v.runs?.length))
    .map(([, v]) => v)
    .filter((v) => matches(v.name, v.queryText, v.businessUnit?.name))
    .sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0))
    .slice(0, MAX_RECORDS)
    .map((v) => ({
      kind: 'query', label: v.name || 'Untitled query', hint: v.source === 'builder' ? 'Query Builder' : 'Saved query',
      to: { path: v.source === 'builder' ? '/queries/builder' : '/queries/workspace', query: { id: v.id } },
    }))
  const emails = records
    .filter(([k, v]) => k.startsWith('email_') && v?.assetId != null)
    .map(([, v]) => v)
    .filter((v) => matches(v.name, v.subject, v.categoryName, v.assetId))
    .slice(0, MAX_RECORDS)
    .map((v) => ({ kind: 'email', label: v.name || `Email ${v.assetId}`, hint: 'Email', to: { path: `/emails/${encodeURIComponent(v.id)}` } }))
  // Query and Script activities with saved versions (feedback #122).
  const activities = records
    .filter(([k, v]) => /^activity_(query|script)_/.test(k) && Array.isArray(v?.versions) && v.versions.length)
    .map(([, v]) => v)
    .filter((v) => matches(v.name, v.key, v.activityId, v.versions[0]?.content))
    .slice(0, MAX_RECORDS)
    .map((v) => ({ kind: 'activity', label: v.name || v.activityId, hint: v.kind === 'script' ? 'Saved Script' : 'Saved SQL Query', to: { path: `/saved-activities/${v.id}` } }))
  const actions = SEARCH_ACTIONS.filter((a) => !a.when || a.when(text.trim())).map((a) => ({
    kind: 'search', label: `Search ${a.label} for "${text.trim()}"`, hint: 'SFMC', to: { path: a.path, query: { ...(a.query || {}), q: text.trim() } },
  }))
  return [...out, ...queries, ...emails, ...activities, ...actions]
}
