// The SELECT that Automation Viewer's Data Extension Finder wrote from ticked fields:
// every ticked field, FROM the first DE, and an INNER JOIN for each other DE on the
// first column name the two share. When they share none, the first ticked fields are
// joined and the SQL starts with a "MUST REVIEW" comment.
import { sqlName } from './format.js'

/**
 * @param {Array<{ de: string, fields: string[], sourceType?: string }>} selections  in the order ticked
 *   (sourceType 'shared': a Shared DE, read from a child business unit as ENT.[name], feedback #73)
 * @returns {string} '' when nothing is ticked
 */
export function buildDESelect(selections) {
  const tables = selections.filter((s) => s.fields.length)
  if (!tables.length) return ''
  const alias = new Map(tables.map((t, i) => [t.de, tables.length > 1 ? `t${i + 1}` : null]))
  const shared = new Set(tables.filter((t) => t.sourceType === 'shared').map((t) => t.de))
  const ref = (de, field) => (alias.get(de) ? `${alias.get(de)}.${sqlName(field)}` : sqlName(field))
  const from = (de) => `${shared.has(de) ? 'ENT.' : ''}${sqlName(de)}${alias.get(de) ? ` ${alias.get(de)}` : ''}`

  const columns = tables.flatMap((t) => t.fields.map((f) => ref(t.de, f)))
  const lines = [`SELECT\n    ${columns.join(',\n    ')}`, `FROM ${from(tables[0].de)}`]
  const review = []
  const [first, ...rest] = tables
  for (const t of rest) {
    const shared = first.fields.find((f) => t.fields.some((g) => g.toLowerCase() === f.toLowerCase()))
    const left = shared ?? first.fields[0]
    const right = shared ? t.fields.find((g) => g.toLowerCase() === shared.toLowerCase()) : t.fields[0]
    if (!shared) review.push(`-- MUST REVIEW: ${first.de} and ${t.de} share no selected column; the join below uses the first selected column of each.`)
    lines.push(`INNER JOIN ${from(t.de)}\n    ON ${ref(first.de, left)} = ${ref(t.de, right)}`)
  }
  return [...review, ...(review.length ? [''] : []), ...lines].join('\n')
}
