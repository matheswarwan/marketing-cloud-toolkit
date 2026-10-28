import pkg from 'node-sql-parser/build/transactsql.js'

const { Parser } = pkg
const parser = new Parser()

/**
 * Parses SQL into a single SELECT statement's AST using the TransactSQL dialect
 * (the closest match to SFMC's SQL Server-based query engine). Returns null if
 * parsing fails or the statement isn't a SELECT — callers fall back to the
 * regex-based extraction below in that case. SFMC's own engine is what actually
 * runs the query; this AST is only used client-side for column naming / type
 * inference, so a parse failure just means falling back, not a broken query.
 */
function astifySelect(sql) {
  if (!sql) return null
  try {
    const ast = parser.astify(sql, { database: 'transactsql' })
    const stmt = Array.isArray(ast) ? ast[0] : ast
    return stmt?.type === 'select' ? stmt : null
  } catch {
    return null
  }
}

/**
 * Extracts all Data Extension names referenced in FROM and JOIN clauses.
 * Handles both plain names (FROM MyDE) and bracket notation (FROM [My DE]).
 *
 * @param {string} sql
 * @returns {string[]} Unique DE names
 */
export function extractDataExtensions(sql) {
  if (!sql) return []

  const stmt = astifySelect(sql)
  if (stmt) {
    const results = new Set()
    for (const entry of stmt.from || []) {
      if (typeof entry.table === 'string') results.add(entry.table)
    }
    if (results.size) return [...results]
  }

  return legacyExtractDataExtensions(sql)
}

function legacyExtractDataExtensions(sql) {
  const results = new Set()

  // Bracket notation: FROM [schema].[My DE], FROM ENT.[My DE] or FROM [My DE]
  const bracketRegex = /(?:FROM|JOIN)\s+(?:\[[^\]]+\]\.|\w+\.)?\[([^\]]+)\]/gi
  // Plain notation: FROM schema.MyDE or FROM MyDE (strips optional schema prefix).
  // A name followed by "." is a prefix (ENT.[My DE]), not a table.
  const plainRegex = /(?:FROM|JOIN)\s+(?:\w+\.)?(\w+)(?![\w.])/gi

  let match
  while ((match = bracketRegex.exec(sql)) !== null) results.add(match[1])
  while ((match = plainRegex.exec(sql)) !== null) results.add(match[1])

  return [...results]
}

/**
 * Splits a SELECT clause on commas that are at parenthesis depth 0.
 * Prevents splitting inside CONVERT(type, expr), COUNT(DISTINCT ...), CASE WHEN ... END, etc.
 * Legacy fallback only — used when AST parsing fails.
 *
 * @param {string} clause
 * @returns {string[]}
 */
function splitSelectColumns(clause) {
  const cols = []
  let depth = 0, start = 0, inStr = false, strChar = ''
  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i]
    if (inStr) {
      // '' (or "") inside a string is an escaped literal quote, not the end of
      // the string — peek ahead and skip both chars instead of toggling inStr.
      if (ch === strChar) {
        if (clause[i + 1] === strChar) { i++; continue }
        inStr = false
      }
    } else if (ch === "'" || ch === '"') {
      inStr = true; strChar = ch
    } else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      cols.push(clause.slice(start, i).trim())
      start = i + 1
    }
  }
  cols.push(clause.slice(start).trim())
  return cols.filter(Boolean)
}

// Best-effort display name for a column AST node lacking an explicit alias.
function fallbackColumnName(expr) {
  if (!expr) return null
  switch (expr.type) {
    case 'aggr_func':
      return expr.name || null
    case 'function':
      return expr.name?.name?.[0]?.value || null
    case 'cast':
      return 'CAST'
    default:
      return null
  }
}

/**
 * Extracts column names or aliases from the SELECT clause of a SQL query.
 * - `col AS alias`              → alias
 * - `tbl.col AS alias`          → alias
 * - `FUNC(...) AS alias`        → alias  (CAST, CONVERT, COUNT, …)
 * - `col`                       → col
 * - `tbl.col`                   → col (unqualified name)
 * - `SELECT *`                  → [] (caller should use a fallback)
 *
 * @param {string} sql
 * @returns {string[]} Column names/aliases in SELECT order
 */
export function extractSelectColumns(sql) {
  if (!sql) return []

  const stmt = astifySelect(sql)
  if (stmt) {
    const columns = stmt.columns
    if (columns === '*') return []
    if (Array.isArray(columns)) {
      // SELECT * (bare, single column, no table qualifier) → let caller fall back.
      if (columns.length === 1 && columns[0].expr?.type === 'column_ref'
        && columns[0].expr.column === '*' && !columns[0].expr.table) {
        return []
      }
      const results = []
      for (const col of columns) {
        if (col.as) { results.push(col.as); continue }
        if (col.expr?.type === 'column_ref' && col.expr.column && col.expr.column !== '*') {
          results.push(col.expr.column); continue
        }
        const fallback = fallbackColumnName(col.expr)
        if (fallback) results.push(fallback)
      }
      return results
    }
  }

  return legacyExtractSelectColumns(sql)
}

function legacyExtractSelectColumns(sql) {
  // Extract the SELECT clause: everything between SELECT and FROM
  const selectClauseMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\b/i)
  if (!selectClauseMatch) return []

  const selectClause = selectClauseMatch[1].trim()

  // Strip DISTINCT and TOP N modifiers before further parsing
  const normalized = selectClause
    .replace(/^DISTINCT\s+/i, '')
    .replace(/^TOP\s+\d+\s+/i, '')

  // Handle SELECT *
  if (normalized === '*') return []

  // Split respecting parenthesis depth (handles CONVERT(type, expr), etc.)
  const columns = splitSelectColumns(normalized)

  const results = []
  for (const part of columns) {
    // [Bracket Name] AS 'quoted' or "quoted" alias
    const bracketQuotedAlias = part.match(/\[[^\]]+\]\s+AS\s+['"]([^'"]+)['"]/i)
    if (bracketQuotedAlias) { results.push(bracketQuotedAlias[1]); continue }

    // [Bracket Name] AS unquoted alias
    const bracketAliasMatch = part.match(/\[[^\]]+\]\s+AS\s+(\w+)/i)
    if (bracketAliasMatch) { results.push(bracketAliasMatch[1]); continue }

    // plain or table.col AS 'quoted' or "quoted" alias
    const quotedAliasMatch = part.match(/(?:\w+\.)?\w+\s+AS\s+['"]([^'"]+)['"]/i)
    if (quotedAliasMatch) { results.push(quotedAliasMatch[1]); continue }

    // Function/expression ending with closing paren: FUNC(...) AS alias
    const funcAliasMatch = part.match(/\)\s+AS\s+(\w+)\s*$/i)
    if (funcAliasMatch) { results.push(funcAliasMatch[1]); continue }

    // plain or table.col AS unquoted alias — anchored to end to avoid matching inside CAST(x AS type)
    const aliasMatch = part.match(/(?:\w+\.)?\w+\s+AS\s+(\w+)\s*$/i)
    if (aliasMatch) { results.push(aliasMatch[1]); continue }

    // [Bracket Name] with no alias - use the bracket content
    const bracketPlainMatch = part.match(/^\s*\[([^\]]+)\]/)
    if (bracketPlainMatch) { results.push(bracketPlainMatch[1]); continue }

    // plain or table.col with no alias
    const plainMatch = part.match(/(?:\w+\.)?(\w+)\s*$/)
    if (plainMatch) { results.push(plainMatch[1]); continue }

    // unaliased function call (ends with ')') — use function name as fallback header
    const funcNameMatch = part.match(/^(\w+)\s*\(/)
    if (funcNameMatch) results.push(funcNameMatch[1])
  }
  return results
}

const CAST_TYPE_MAP = {
  date: 2, datetime: 2, datetime2: 2, smalldatetime: 2, datetimeoffset: 2,
  int: 1, integer: 1, bigint: 1, smallint: 1, tinyint: 1,
  float: 6, decimal: 6, numeric: 6, real: 6, money: 6,
  varchar: 0, nvarchar: 0, char: 0, nchar: 0, text: 0,
  bit: 3,
}

// Type keyword from a CONVERT(type, expr)-style first argument, which the
// TransactSQL grammar parses as either a function call (`varchar(50)`) or a
// bare column reference (`int`, no parens) depending on whether it has a length.
function typeNameFromNode(node) {
  if (!node) return null
  if (node.type === 'function') return node.name?.name?.[0]?.value ?? null
  if (node.type === 'column_ref') return node.column ?? null
  return null
}

/**
 * Scans the SELECT clause for type-casting expressions and returns a map of
 * alias.toLowerCase() → SFMC field type number.
 * Handles: CAST(expr AS type), CONVERT(type, expr), TRY_CAST, TRY_CONVERT.
 * Used to infer DE field types when the source DE fields are inaccessible.
 *
 * @param {string} sql
 * @returns {Object} { [aliasLower]: sfmcTypeNumber }
 */
export function inferSelectColumnTypes(sql) {
  if (!sql) return {}

  const stmt = astifySelect(sql)
  if (stmt && Array.isArray(stmt.columns)) {
    const result = {}
    for (const [alias, d] of Object.entries(columnDetailsFromStmt(stmt))) {
      if (d.type !== undefined) result[alias] = d.type
    }
    return result
  }

  return legacyInferSelectColumnTypes(sql)
}

// Functions whose SFMC field type doesn't depend on their arguments.
const FUNCTION_TYPE_MAP = {
  GETDATE: 2, GETUTCDATE: 2, SYSDATETIME: 2, SYSUTCDATETIME: 2, SYSDATETIMEOFFSET: 2,
  CURRENT_TIMESTAMP: 2, DATEADD: 2, EOMONTH: 2, DATEFROMPARTS: 2, DATETIMEFROMPARTS: 2,
  SMALLDATETIMEFROMPARTS: 2, TODATETIMEOFFSET: 2, SWITCHOFFSET: 2,
  COUNT: 1, COUNT_BIG: 1, DATEDIFF: 1, DATEPART: 1, YEAR: 1, MONTH: 1, DAY: 1, LEN: 1,
  DATALENGTH: 1, CHARINDEX: 1, PATINDEX: 1, ROW_NUMBER: 1, RANK: 1, DENSE_RANK: 1, NTILE: 1,
  ISNUMERIC: 1, ISDATE: 1,
}

// Functions that return the type of their first argument (MAX(s.EventDate) is a Date).
const PASSTHROUGH_FUNCTIONS = new Set(['MIN', 'MAX', 'ISNULL', 'COALESCE', 'FIRST_VALUE', 'LAST_VALUE', 'LAG', 'LEAD'])

function functionName(expr) {
  if (expr?.type === 'aggr_func') return String(expr.name || '').toUpperCase()
  if (expr?.type === 'function') return (expr.name?.name?.[0]?.value || '').toUpperCase()
  return ''
}

function firstArg(expr) {
  if (expr?.type === 'aggr_func') return expr.args?.expr ?? null
  return expr?.args?.value?.[0] ?? null
}

// Describes one SELECT expression: { type, length, scale } when it can be
// worked out from the expression alone, or { source } (a column name) when the
// type should come from the source DE / data view field it passes through.
function describeExpr(expr) {
  if (!expr) return {}
  if (expr.type === 'column_ref' && typeof expr.column === 'string') {
    return { source: expr.column.toLowerCase() }
  }
  if (expr.type === 'cast') {
    const target = expr.target?.[0]
    const sfmcType = target?.dataType ? CAST_TYPE_MAP[target.dataType.toLowerCase()] : undefined
    if (sfmcType === undefined) return {}
    const d = { type: sfmcType }
    if (typeof target.length === 'number') d.length = target.length
    if (typeof target.scale === 'number') d.scale = target.scale
    return d
  }
  const fn = functionName(expr)
  if (!fn) return {}
  if (fn === 'CONVERT' || fn === 'TRY_CONVERT') {
    const typeName = typeNameFromNode(expr.args?.value?.[0])
    const sfmcType = typeName ? CAST_TYPE_MAP[typeName.toLowerCase()] : undefined
    return sfmcType !== undefined ? { type: sfmcType } : {}
  }
  if (FUNCTION_TYPE_MAP[fn] !== undefined) return { type: FUNCTION_TYPE_MAP[fn] }
  if (PASSTHROUGH_FUNCTIONS.has(fn)) return describeExpr(firstArg(expr))
  return {}
}

function columnDetailsFromStmt(stmt) {
  const result = {}
  for (const col of stmt.columns) {
    const d = describeExpr(col.expr)
    const name = col.as ?? (col.expr?.type === 'column_ref' ? col.expr.column : null)
    if (typeof name !== 'string') continue
    // A bare column (no alias) gets its type from the source field of the same name already.
    if (!col.as && d.source) continue
    if (Object.keys(d).length) result[name.toLowerCase()] = d
  }
  return result
}

/**
 * Like inferSelectColumnTypes, but returns more per output column:
 * { [aliasLower]: { type?, length?, scale?, source? } }.
 * `source` is the lower-cased source column an aliased pass-through
 * (`s.EventDate AS SendDate`, `MAX(s.EventDate) AS LastSend`) reads from, so
 * the caller can copy that source field's type. Falls back to the CAST-only
 * legacy parser when the query can't be parsed.
 *
 * @param {string} sql
 * @returns {Object}
 */
export function inferSelectColumnDetails(sql) {
  if (!sql) return {}
  const stmt = astifySelect(sql)
  if (stmt && Array.isArray(stmt.columns)) return columnDetailsFromStmt(stmt)
  const result = {}
  for (const [alias, type] of Object.entries(legacyInferSelectColumnTypes(sql))) result[alias] = { type }
  return result
}

function legacyInferSelectColumnTypes(sql) {
  const selectClauseMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\b/i)
  if (!selectClauseMatch) return {}
  const selectClause = selectClauseMatch[1].trim()
    .replace(/^DISTINCT\s+/i, '')
    .replace(/^TOP\s+\d+\s+/i, '')
  if (selectClause === '*') return {}

  const result = {}
  const columns = splitSelectColumns(selectClause)
  for (const part of columns) {
    const outerAlias = part.match(/\)\s+AS\s+(\w+)\s*$/i)
    if (!outerAlias) continue
    const alias = outerAlias[1]

    // CONVERT(type, expr) or TRY_CONVERT(type, expr) — type is first argument
    const convertMatch = part.match(/\b(?:TRY_)?CONVERT\s*\(\s*(\w+)\s*,/i)
    if (convertMatch) {
      const sfmcType = CAST_TYPE_MAP[convertMatch[1].toLowerCase()]
      if (sfmcType !== undefined) result[alias.toLowerCase()] = sfmcType
      continue
    }

    // CAST(expr AS type) or TRY_CAST(expr AS type) — greedy .* handles nested parens
    const castMatch = part.match(/\b(?:TRY_)?CAST\s*\(.*\bAS\s+(\w+)\s*\)/i)
    if (castMatch) {
      const sfmcType = CAST_TYPE_MAP[castMatch[1].toLowerCase()]
      if (sfmcType !== undefined) result[alias.toLowerCase()] = sfmcType
    }
  }
  return result
}
