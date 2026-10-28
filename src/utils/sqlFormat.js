import { format } from 'sql-formatter'
import { tokenize } from './sqlTokens.js'

// Formats SFMC SQL with sql-formatter's T-SQL dialect. As a safety net, the
// result is only used if it still has exactly the same tokens as the input
// (keywords compared case-insensitively, everything else exactly). If the
// formatter drops or changes anything, or throws, the input comes back unchanged.

const OPTIONS = {
  language: 'tsql',
  keywordCase: 'upper',
  tabWidth: 4,
  linesBetweenQueries: 1,
}

function tokenKey(t) {
  if (t.type === 'word') return 'w:' + t.upper
  if (t.type === 'comment') return 'c:' + t.value.replace(/\s+/g, ' ').trim()
  return t.type + ':' + t.value
}

export function sameTokens(a, b) {
  const ta = tokenize(a).filter(t => t.type !== 'ws').map(tokenKey)
  const tb = tokenize(b).filter(t => t.type !== 'ws').map(tokenKey)
  return ta.length === tb.length && ta.every((k, i) => k === tb[i])
}

/**
 * @param {string} sql
 * @returns {{ ok: boolean, sql: string, error?: string }}
 */
export function formatSql(sql) {
  if (!sql?.trim()) return { ok: false, sql, error: 'Nothing to format' }
  let out
  try {
    out = format(sql, OPTIONS)
  } catch (err) {
    return { ok: false, sql, error: `Could not format: ${err.message?.split('\n')[0] || 'parse error'}` }
  }
  if (!sameTokens(sql, out)) {
    return { ok: false, sql, error: 'Formatting would have changed the query, so it was left as is' }
  }
  return { ok: true, sql: out }
}

