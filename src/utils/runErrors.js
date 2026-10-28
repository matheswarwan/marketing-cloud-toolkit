// Explains SFMC query errors: the likely cause and a fix, from the error text and,
// when SFMC gives no reason ("system error", a failed run with no message), from the
// SQL itself. The messages are SQL Server's and SFMC's own wording.
import { tokenize, significant, isWord } from './sqlTokens.js'

const RULES = [
  {
    test: /conversion failed when converting (the )?date and\/or time from character string|converting (a )?(n?varchar|char) data type to a datetime/i,
    cause: 'A text value could not be read as a date (an empty string, a day-month order SFMC reads the other way, or not a date at all).',
    fix: "Use TRY_CONVERT(DATETIME, x, <style>) (it gives NULL instead of failing), or filter with ISDATE(x) = 1 first. Pick the style for the text's format, e.g. 103 for dd/mm/yyyy.",
  },
  {
    test: /conversion failed when converting the (n?varchar|char) value .* to data type (int|bigint|smallint|tinyint)/i,
    cause: 'A text value with something other than digits was turned into a whole number.',
    fix: 'Use TRY_CAST(x AS INT) (NULL instead of failing), or check with ISNUMERIC / a LIKE pattern first.',
  },
  {
    test: /error converting data type (n?varchar|char) to (numeric|decimal|float|real)/i,
    cause: 'A text value could not be read as a number (a comma as the decimal separator, a currency sign, or empty text).',
    fix: "Use TRY_CONVERT(DECIMAL(18,2), x), and REPLACE(x, ',', '.') first if the decimals use commas.",
  },
  {
    test: /arithmetic overflow error converting expression to data type int|the datediff function resulted in an overflow/i,
    cause: 'A number grew past the INT limit (about 2.1 billion): DATEDIFF in SECOND or MILLISECOND over a long span, a Unix time in milliseconds, or a SUM of large values.',
    fix: 'Use DATEDIFF_BIG, or CAST(... AS BIGINT) before adding up; for Unix milliseconds, divide by 1000 before DATEADD(SECOND, ...).',
  },
  {
    test: /arithmetic overflow error converting (numeric|float|expression) to data type numeric/i,
    cause: 'A value has more digits than the Decimal field or CAST allows.',
    fix: 'Widen the target Decimal field (precision) or CAST to a larger DECIMAL(p, s).',
  },
  {
    test: /divide by zero error/i,
    cause: 'A division (/ or %) by a value that is 0 for some rows.',
    fix: 'Divide by NULLIF(divisor, 0): the result is NULL for those rows instead of a failed run.',
  },
  {
    test: /invalid length parameter passed to the (left|right|substring)/i,
    cause: 'LEFT, RIGHT or SUBSTRING got a negative length, usually CHARINDEX(...) - 1 on rows where the text is not found (CHARINDEX gives 0).',
    fix: 'Guard the length: LEFT(x, NULLIF(CHARINDEX(\'@\', x), 0) - 1), or a CASE that checks CHARINDEX > 0.',
  },
  {
    test: /string or binary data would be truncated|data would be truncated/i,
    cause: 'A text value is longer than its target field.',
    fix: 'Make the target field longer (up to 4000), or cut the value with LEFT(x, <length>).',
  },
  {
    test: /violation of primary key constraint|cannot insert duplicate key/i,
    cause: 'The query returns the same primary key more than once (or Append adds keys that are already in the target).',
    fix: 'Keep one row per key, e.g. ROW_NUMBER() OVER (PARTITION BY key ORDER BY date DESC) = 1 in a subquery, or use Update instead of Append.',
  },
  {
    test: /cannot insert the value null into column '?([^',]+)/i,
    cause: 'A required field (or the primary key) of the target gets NULL for some rows.',
    fix: 'Give the column a value for every row (ISNULL(x, \'\') or COALESCE), filter out rows where it is NULL, or make the field nullable.',
  },
  {
    test: /ambiguous column name/i,
    cause: 'A column without a table alias exists in more than one joined table.',
    fix: 'Write it as alias.[Column] (for example s.[SubscriberKey]).',
  },
  {
    test: /the multi-part identifier .* could not be bound/i,
    cause: 'A column is prefixed with an alias or table name that is not in this FROM (a typo, or the alias belongs to another subquery).',
    fix: 'Check the alias against FROM and JOIN; inside a subquery use that subquery\'s own aliases.',
  },
  {
    test: /invalid column name/i,
    cause: 'A column does not exist in the table, or a text value was written in double quotes ("abc"), which SQL reads as a column name.',
    fix: "Check the field name (spaces need [brackets]); put text values in single quotes: 'abc'.",
  },
  {
    test: /invalid object name|is not a known data extension|could not find (the )?data extension/i,
    cause: 'A data extension name is wrong or not visible in this business unit (a Shared DE needs ENT. in a child BU; data views have no brackets).',
    fix: 'Check the exact name; use ENT.[Name] for Shared data extensions from a child BU.',
  },
  {
    test: /is not a recognized built-in function name/i,
    cause: 'The function does not exist in SFMC\'s SQL (it is from another database, like NOW, IFNULL, NVL or DATE_TRUNC, or newer than SFMC\'s engine).',
    fix: 'Use the SQL Server equivalent: GETDATE() for NOW(), ISNULL or COALESCE for IFNULL/NVL, DATEADD/DATEPART for DATE_TRUNC.',
  },
  {
    test: /windowed functions can only appear in the select or order by clauses/i,
    cause: 'ROW_NUMBER(), RANK() or another OVER(...) function is used in WHERE, GROUP BY or HAVING.',
    fix: 'Compute it in a subquery, then filter on its alias outside: SELECT ... FROM (SELECT ..., ROW_NUMBER() OVER (...) AS rn FROM ...) x WHERE rn = 1.',
  },
  {
    test: /the order by clause is invalid in views, inline functions, derived tables, subqueries/i,
    cause: 'ORDER BY without TOP. SFMC wraps the query, so ORDER BY alone is refused, at the top level too.',
    fix: 'Remove ORDER BY (a data extension keeps no row order anyway), or add TOP n when you want only the first n rows.',
  },
  {
    test: /incorrect syntax near (the keyword )?'?(limit|offset)'?/i,
    cause: 'LIMIT is MySQL/PostgreSQL syntax.',
    fix: 'Use SELECT TOP n ... instead of LIMIT n.',
  },
  {
    test: /column '([^']+)' is invalid in the select list because it is not contained in either an aggregate function or the group by clause/i,
    cause: 'A column in SELECT is neither grouped nor inside COUNT/SUM/MAX/MIN.',
    fix: 'Add it to GROUP BY, or wrap it in MAX(...) / MIN(...).',
  },
  {
    test: /no column name was specified for column/i,
    cause: 'An expression in SELECT has no name; SFMC needs a name for every column to write it to the data extension.',
    fix: 'Add AS [Name] after the expression.',
  },
  {
    test: /timed? ?out|exceeded the (maximum )?(execution )?time|took longer than 30 minutes/i,
    cause: 'The query ran longer than SFMC allows (30 minutes for a query activity).',
    fix: 'Filter the large tables earlier (a date range on data views), join on key fields, avoid functions on joined columns, or split the work into steps.',
  },
]

/** Things in the SQL that make a run fail without a useful message. */
function scanSql(sql) {
  const s = String(sql || '')
  const out = []
  const toks = significant(tokenize(s))
  const has = (re) => re.test(s)
  if (has(/\b(CONVERT|CAST)\s*\(\s*(DATE|DATETIME|DATETIME2|SMALLDATETIME)\b/i) || has(/\bCAST\s*\([^()]*\bAS\s+(DATE|DATETIME|DATETIME2)\b/i)) {
    out.push('CONVERT or CAST to a date fails the whole run on one bad value: use TRY_CONVERT / TRY_CAST.')
  }
  if (has(/\bCAST\s*\([^()]*\bAS\s+(INT|BIGINT|DECIMAL|NUMERIC|FLOAT)\b/i) || has(/\bCONVERT\s*\(\s*(INT|BIGINT|DECIMAL|NUMERIC|FLOAT)\b/i)) {
    out.push('CAST or CONVERT to a number fails on any non-numeric text: use TRY_CAST / TRY_CONVERT.')
  }
  if (has(/\bDATEDIFF\s*\(\s*(SECOND|SS|S|MILLISECOND|MS)\b/i)) out.push('DATEDIFF in seconds or milliseconds overflows INT over long spans: use DATEDIFF_BIG.')
  if (has(/\b(LEFT|RIGHT|SUBSTRING)\s*\([^;]*CHARINDEX\s*\([^)]*\)\s*-\s*\d/i)) out.push('LEFT/SUBSTRING with CHARINDEX(...) - 1 fails when the text is not found: wrap CHARINDEX in NULLIF(..., 0).')
  if (toks.some((t) => t.type === 'op' && (t.value === '/' || t.value === '%'))) out.push('A division fails when the divisor is 0 for any row: divide by NULLIF(divisor, 0).')
  if (has(/\bSTRING_AGG\s*\(/i) && !has(/\bSTRING_AGG\s*\(\s*CAST\s*\([^)]*NVARCHAR\s*\(\s*MAX/i)) out.push('STRING_AGG fails past 4,000 characters (8,000 bytes): aggregate CAST(x AS NVARCHAR(MAX)).')
  const all = tokenize(s).filter((t) => t.type !== 'ws')
  const last = all[all.length - 1]
  if (last?.type === 'comment' && last.line) out.push('The query ends with a -- comment: SFMC adds text after the query, which the comment then swallows. Use /* */ or remove it.')
  if (toks.some((t) => t.depth === 0 && isWord(t, 'ORDER')) && !toks.some((t) => isWord(t, 'TOP'))) out.push('ORDER BY without TOP is refused by SFMC.')
  return out
}

/**
 * { cause, fix, sqlHints } for an error message (and the SQL that ran), or null when
 * there is nothing useful to add.
 */
export function explainRunError(message, sql = '') {
  const text = String(message || '')
  if (!text || /SESSION_EXPIRED|Cannot find table 0/i.test(text)) return null
  const rule = RULES.find((r) => r.test.test(text))
  const vague = !rule && /system error|unknown error|an error (has )?occurred|failed|error/i.test(text)
  const sqlHints = rule || vague ? scanSql(sql) : []
  if (rule) return { cause: rule.cause, fix: rule.fix, sqlHints }
  if (vague && sqlHints.length) {
    return { cause: 'SFMC gave no reason. These parts of the SQL often fail a run:', fix: '', sqlHints }
  }
  return null
}
