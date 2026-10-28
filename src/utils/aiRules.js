// "Copy SQL rules for AI": the Toolkit's SFMC SQL checks and data view join keys as
// Markdown, so an AI assistant writes queries that pass them (paste it into the chat
// or a project's instructions).
import { LINT_RULES } from './sqlLint.js'
import { JOIN_RULES, DATA_VIEWS } from './dataViews.js'

const FACTS = [
  'SFMC runs SQL Server (T-SQL) SELECT statements only, as a query activity that writes the result into a data extension. No INSERT, UPDATE, DELETE, variables, temp tables, CTEs (WITH) or stored procedures.',
  'Every output column needs a name (AS [Name]) and the names must be unique; they must match the target data extension\'s fields.',
  'ORDER BY is allowed only with TOP. A data extension keeps no row order.',
  'Data extension names with spaces or dashes go in [brackets]. Shared data extensions are read as ENT.[Name] from a child business unit. Data views (_Sent, _Open, ...) are written bare.',
  'Text values use single quotes. Double quotes mean a column name.',
  'Use GETDATE() (server time is Central Standard Time without daylight saving), DATEADD, DATEDIFF; TOP n, not LIMIT; + or CONCAT, not ||; ISNULL/COALESCE, not IFNULL/NVL.',
  'Prefer TRY_CONVERT / TRY_CAST over CONVERT / CAST, and NULLIF(divisor, 0) for division: one bad row fails the whole run.',
  'A query activity times out after 30 minutes; data views keep about 6 months of data, so filter them on a date.',
  'Avoid -- comments at the very end of the query; prefer /* */.',
]

export function sqlRulesForAi() {
  const lines = ['# SFMC SQL rules (Marketing Cloud Toolkit)', '', '## Facts', '', ...FACTS.map((f) => `- ${f}`), '', '## Checks the query must pass', '']
  for (const r of LINT_RULES) lines.push(`- ${r.code} (${r.severity}): ${r.title}`)
  lines.push('', '## Data view join keys', '')
  const name = (v) => [...DATA_VIEWS].find((d) => d.toUpperCase() === v) || v
  for (const [lefts, rights, keys] of JOIN_RULES) {
    lines.push(`- ${lefts.map(name).join(', ')} to ${rights.map(name).join(', ')}: ${keys.map(([a, b]) => `${a} = ${b}`).join(' AND ')}`)
  }
  return lines.join('\n') + '\n'
}
