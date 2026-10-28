import { describe, it, expect, vi } from 'vitest'
const upsert = vi.fn(async () => ({}))
vi.mock('../sfmcApi.js', () => ({ upsertDERowsAsync: (...a) => upsert(...a) }))
import { toSnippets, addSnippet, deleteSnippet, SNIPPET_MAX } from '../sharedSnippets.js'

describe('Shared snippets', () => {
  it('reads rows (lower-case keys), newest first, without deleted ones', () => {
    const rows = [
      { keys: { snippetid: 'a' }, values: { name: 'Old', sql: 'SELECT 1', author: 'Jo', created: '2026-01-01', deleted: 'False' } },
      { keys: { snippetid: 'b' }, values: { name: 'New', sql: 'SELECT 2', author: 'Al', created: '2026-05-01', deleted: '' } },
      { keys: { snippetid: 'c' }, values: { name: 'Gone', sql: 'x', deleted: 'True' } },
    ]
    expect(toSnippets(rows).map((s) => s.name)).toEqual(['New', 'Old'])
  })
  it('adds by upsert and deletes by marking the row', async () => {
    const s = await addSnippet('s7', { key: 'K' }, { name: ' Dedupe ', sql: ' SELECT 1 ', author: 'Jo' })
    expect(upsert.mock.calls[0][2][0]).toMatchObject({ SnippetId: s.id, Name: 'Dedupe', Sql: 'SELECT 1', Author: 'Jo', Deleted: false })
    await deleteSnippet('s7', { key: 'K' }, s)
    expect(upsert.mock.calls[1][2]).toEqual([{ SnippetId: s.id, Deleted: true }])
    await expect(addSnippet('s7', { key: 'K' }, { name: 'x', sql: 'a'.repeat(SNIPPET_MAX + 1) })).rejects.toThrow(/4000/)
  })
})
