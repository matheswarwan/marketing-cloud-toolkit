// Builds a Markdown summary of a query run (name, SQL, columns, rows) that can
// be pasted into Claude, ChatGPT or a ticket. Rows are capped so the text stays
// small enough to paste; the cap is stated in the output when it applies.

export const MARKDOWN_ROW_LIMIT = 200

function cell(val) {
  if (val == null) return ''
  return String(val).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/**
 * @param {{ title?: string, sql?: string, columns: string[], rows: object[], totalCount?: number, maxRows?: number }} p
 * @returns {string}
 */
export function buildResultsMarkdown({ title, sql, columns, rows, totalCount, maxRows = MARKDOWN_ROW_LIMIT }) {
  const total = totalCount ?? rows.length
  const shown = rows.slice(0, maxRows)
  const out = []
  out.push(`# ${title || 'SFMC query results'}`, '')
  if (sql?.trim()) out.push('## Query', '', '```sql', sql.trim(), '```', '')
  out.push('## Results', '')
  if (columns.length === 0) {
    out.push('No rows returned.')
    return out.join('\n') + '\n'
  }
  const note = shown.length < total
    ? `${total.toLocaleString('en-US')} rows; the first ${shown.length} are shown.`
    : `${total.toLocaleString('en-US')} row${total === 1 ? '' : 's'}.`
  out.push(note, '')
  out.push(`| ${columns.map(cell).join(' | ')} |`)
  out.push(`| ${columns.map(() => '---').join(' | ')} |`)
  for (const row of shown) out.push(`| ${columns.map(c => cell(row[c])).join(' | ')} |`)
  return out.join('\n') + '\n'
}
