// Shared snippets (from SQL Studio's team snippets): reusable SQL kept in a data
// extension in the business unit, so everyone using the Toolkit there sees the same
// list. Saved queries stay per browser; these are for the team. Rows are never
// removed: Delete marks a row Deleted (only its author is offered Delete).
import {
  searchLocalDEsByName, createTargetDE, buildDEFields, getDERootFolderId,
  fetchDERows, upsertDERowsAsync,
} from './sfmcApi.js'

export const SNIPPET_DE = 'Toolkit_Shared_Snippets'
export const SNIPPET_MAX = 4000

export const SNIPPET_FIELDS = [
  { name: 'SnippetId', type: 0, length: 50, isPrimaryKey: true, isNullable: false },
  { name: 'Name', type: 0, length: 200, isNullable: false },
  { name: 'Sql', type: 0, length: SNIPPET_MAX, isNullable: false },
  { name: 'Author', type: 0, length: 254, isNullable: true },
  { name: 'Created', type: 2, isNullable: true },
  { name: 'Deleted', type: 3, isNullable: true },
]

/** The snippets DE in this BU ({ id, key, name }), or null. */
export async function findSnippetDE(stack) {
  const r = await searchLocalDEsByName(stack, SNIPPET_DE)
  const hit = (r?.items || []).find((d) => String(d.name).toLowerCase() === SNIPPET_DE.toLowerCase())
  return hit ? { id: hit.id, key: hit.customerKey || hit.key, name: hit.name } : null
}

export async function createSnippetDE(stack) {
  const categoryID = await getDERootFolderId(stack)
  const made = await createTargetDE(stack, { name: SNIPPET_DE, categoryID, fields: buildDEFields(SNIPPET_FIELDS) })
  return { id: made.id, key: made.customerKey, name: SNIPPET_DE }
}

/** Rows to snippets (the rowset lower-cases keys), newest first, deleted ones left out. */
export function toSnippets(items = []) {
  return items
    .map((it) => ({ ...(it.keys || {}), ...(it.values || {}) }))
    .map((r) => ({
      id: r.snippetid, name: r.name || '', sql: r.sql || '', author: r.author || '',
      created: r.created || '', deleted: String(r.deleted).toLowerCase() === 'true',
    }))
    .filter((s) => s.id && !s.deleted)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))
}

export async function listSnippets(stack, de) {
  const data = await fetchDERows(stack, de.key, 1, 2500)
  return toSnippets(data?.items || [])
}

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)

/** Adds a snippet (async; it shows to others once SFMC has written it). Returns it. */
export async function addSnippet(stack, de, { name, sql, author }) {
  const text = String(sql || '').trim()
  if (!String(name || '').trim()) throw new Error('Name the snippet.')
  if (!text) throw new Error('The snippet has no SQL.')
  if (text.length > SNIPPET_MAX) throw new Error(`Snippets hold up to ${SNIPPET_MAX} characters; this one has ${text.length}.`)
  const s = { id: newId(), name: String(name).trim().slice(0, 200), sql: text, author: String(author || '').slice(0, 254), created: new Date().toISOString(), deleted: false }
  await upsertDERowsAsync(stack, de.key, [{ SnippetId: s.id, Name: s.name, Sql: s.sql, Author: s.author, Created: s.created, Deleted: false }])
  return s
}

export async function deleteSnippet(stack, de, snippet) {
  await upsertDERowsAsync(stack, de.key, [{ SnippetId: snippet.id, Deleted: true }])
}
