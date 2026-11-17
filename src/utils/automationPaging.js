// Paging for Automation Studio's legacy list
// (`legacy/v1/beta/automations/automation/definition/`).
//
// That list reads `$skip` as a page number, not a row offset (feedback #1100, checked
// live on s10 with 452 automations, 2026-11-16): `$top=50&$skip=2` gives rows 100-149
// and `startIndex: 100`, while `$skip=50` asks for page 50 and answers no rows with
// `totalResults: 0`. Callers keep counting in rows; this module turns rows into pages.
// No imports, so the service worker (background/dashboard.js) can use it too.

/** The `$top` and `$skip` query values for the page that holds row `row`. */
export function legacyPageParams(row, top) {
  return `$top=${top}&$skip=${Math.floor(Math.max(0, row) / top)}`
}

/**
 * Rows `skip` to `skip + top` of the list. `readPage(params)` reads one page for the
 * given `$top`/`$skip` query values and returns { entries, total }. When `skip` is not
 * on a page boundary, two pages are read and cut to size. `total` comes from a page
 * that had rows: SFMC answers 0 for a page past the end.
 */
export async function legacyRows(skip, top, readPage) {
  const start = Math.max(0, skip)
  const offset = start % top
  const first = await readPage(legacyPageParams(start, top))
  if (!offset) return first
  const second = first.entries.length === top ? await readPage(legacyPageParams(start + top, top)) : { entries: [], total: 0 }
  return {
    entries: [...first.entries, ...second.entries].slice(offset, offset + top),
    total: first.entries.length ? first.total : second.total,
  }
}
