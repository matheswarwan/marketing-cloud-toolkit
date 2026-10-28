// Automation Templates: each template describes the data extensions, Query
// activities and automation it needs (plan), and what the user does before and
// after. createFromPlan makes them in SFMC; nothing is scheduled or run.
import { orphanContacts } from './orphanContacts.js'
import { dataViewArchive } from './dataViewArchive.js'
import { unengagedSubscribers, heldBounced, automationRunLog, crmUnsubscribes } from './engagement.js'
import {
  buildDEFields, createTemplateDE, createQueryActivity, createAutomation, getDERootFolderId, getQueryRootFolderId,
  getAnyQueryActivityId, validateQueryText, deleteDE, deleteQueryActivity, deleteAutomation,
} from '../sfmcApi.js'

export const TEMPLATES = [orphanContacts, dataViewArchive, unengagedSubscribers, heldBounced, automationRunLog, crmUnsubscribes]

const mentions = (sql, name) => sql.toLowerCase().includes(`[${name.toLowerCase()}]`)

/**
 * Asks SFMC to validate each query that reads only existing tables (not the plan's
 * own data extensions), so a missing list or synchronized DE is found before
 * anything is created (feedback #44). Returns [{ name, error }] for the invalid
 * ones; skipped (empty, with `skipped`) when the business unit has no Query
 * activity to validate through.
 */
export async function checkPlan(stack, plan) {
  let qaId
  try { qaId = await getAnyQueryActivityId(stack) } catch { return Object.assign([], { skipped: true }) }
  const problems = []
  for (const q of plan.queries) {
    if (plan.des.some((d) => mentions(q.sql, d.name))) continue
    try {
      const r = await validateQueryText(stack, qaId, q.sql)
      if (r && r.queryValid === false) {
        problems.push({ name: q.name, error: (r.errors || []).map((e) => e.message).join(' ').replace(/<br\s*\/?>/gi, ' ') || 'SFMC says the query is not valid.' })
      }
    } catch (e) {
      problems.push({ name: q.name, error: e.message })
    }
  }
  return problems
}

/** Deletes what a stopped run created: automation first, then queries, then data extensions. */
export async function deleteCreated(stack, created) {
  const order = { automation: 0, query: 1, de: 2 }
  const del = { automation: deleteAutomation, query: deleteQueryActivity, de: deleteDE }
  const failed = []
  for (const c of [...created].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (!c.id) { failed.push({ ...c, error: 'No ID was returned when it was created; delete it in SFMC.' }); continue }
    try { await del[c.kind](stack, c.id) } catch (e) { failed.push({ ...c, error: e.message }) }
  }
  return failed
}

/**
 * Creates a plan's data extensions, then its Query activities, then the
 * automation, stopping at the first failure. progress(entry) is called for each
 * object ({ kind, name, status: 'creating' | 'done' | 'failed', id?, error?, note? }).
 * Returns { created: [...], failed: entry | null }, so a partial run can be cleaned up.
 */
export async function createFromPlan(stack, plan, progress = () => {}, where = {}) {
  const created = []
  const step = async (kind, name, fn) => {
    progress({ kind, name, status: 'creating' })
    try {
      const r = await fn()
      const entry = { kind, name, status: 'done', ...r }
      created.push(entry)
      progress(entry)
      return entry
    } catch (e) {
      const entry = { kind, name, status: 'failed', error: e.message }
      progress(entry)
      throw Object.assign(e, { entry })
    }
  }
  try {
    progress({ kind: 'check', name: 'Checking the queries with SFMC', status: 'creating' })
    const problems = await checkPlan(stack, plan)
    if (problems.length) {
      const entry = { kind: 'check', name: 'Checking the queries with SFMC', status: 'failed', error: problems.map((p) => `${p.name}: ${p.error}`).join('\n') }
      progress(entry)
      return { created, failed: entry }
    }
    progress({ kind: 'check', name: 'Checking the queries with SFMC', status: 'done', note: problems.skipped ? 'Skipped: this business unit has no Query activity to check through.' : '' })
    // Folders the user picked (feedback #152), else the root folders.
    const deFolder = where.deFolderId != null ? Number.parseInt(where.deFolderId, 10) : await getDERootFolderId(stack)
    const queryFolder = where.queryFolderId ?? await getQueryRootFolderId(stack).catch(() => null)
    const deByRef = {}
    for (const de of plan.des) {
      deByRef[de.ref] = await step('de', de.name, async () => {
        const r = await createTemplateDE(stack, { name: de.name, key: de.key, fields: buildDEFields(de.fields), categoryID: deFolder, sendableField: de.sendableField })
        return {
          id: r?.id ?? null, key: r?.customerKey ?? de.key,
          note: r?.sendableFailed ? `Created as not sendable. Make it sendable in Contact Builder (send relationship ${de.sendableField} to Subscriber Key) before using it to delete contacts.` : '',
        }
      })
    }
    const queryByRef = {}
    for (const q of plan.queries) {
      const target = deByRef[q.target]
      queryByRef[q.ref] = await step('query', q.name, async () => {
        const r = await createQueryActivity(stack, {
          name: q.name, description: 'Created by Marketing Cloud Toolkit (Automation Templates).', queryText: q.sql,
          targetName: target.name, targetKey: target.key, targetId: target.id, updateType: q.updateType, categoryId: queryFolder,
        })
        return { id: r?.queryDefinitionId ?? r?.id ?? null }
      })
    }
    const a = plan.automation
    await step('automation', a.name, async () => {
      const r = await createAutomation(stack, {
        name: a.name, description: a.description, categoryId: where.automationFolderId, notifyEmail: where.notifyEmail,
        steps: a.steps.map((s) => ({ name: s.name, activities: s.queries.map((ref) => ({ name: queryByRef[ref].name, id: queryByRef[ref].id })) })),
      })
      return { id: r?.id ?? null, note: r?.notificationsFailed ? 'SFMC did not take the email notifications; set them in Automation Studio (the automation > Notifications).' : '' }
    })
    return { created, failed: null }
  } catch (e) {
    return { created, failed: e.entry || { kind: 'setup', name: 'Folders', status: 'failed', error: e.message } }
  }
}
