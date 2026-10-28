// Query history (security review, 2026-10-28). Each saved query keeps a list of its
// runs; a run normally records its SQL. With history off (Settings, or the admin
// policy disableHistory), runs are still recorded, because Delete Toolkit runs needs
// the data extension and query activity each one created in SFMC, but without the
// SQL. The capture features (Query Studio, Saved Emails, Saved Activities) are also
// off under the policy.
import { policy } from './policy.js'

export const HISTORY_SETTING = '_keepQueryHistory'

/** True when the SQL of each run may be stored: the setting (on unless false) and no policy. */
export const historyAllowed = (setting) => setting !== false && !policy.disableHistory

/** Runs as they are stored: without their SQL when history is off. */
export function runsForStorage(runs, allowed) {
  const list = Array.from(runs || [])
  if (allowed) return list
  return list.map(({ queryText, ...rest }) => rest)
}
