import { tokenize, significant, isWord, identName, bracket } from './sqlTokens.js'
import { DATA_VIEWS, DATA_VIEW_FIELDS } from './dataViews.js'

// A linter for SFMC SQL Query Activities. Pure JS, no DOM: the editor maps the
// diagnostics onto @codemirror/lint.
//
// Everything is token based (see sqlTokens.js), so text inside strings,
// comments and [brackets] is never mistaken for SQL. node-sql-parser is not
// used: its grammar rejects some valid SFMC SQL, and a linter that goes quiet
// whenever the parser fails would be worse than one that reads tokens.
//
// The query is split into "scopes", one per SELECT (top level, subquery,
// derived table, CTE body, UNION branch). Each scope knows its clauses, its
// select items and its FROM tables, which is what most rules need.
//
// A rule returns { from, to, message, severity?, fixes? } objects; lintSql adds
// the code and default severity. Each rule runs in its own try/catch, so a bug
// in one rule can't hide the others.

// ---------------------------------------------------------------------------
// Word lists

const SET_OPS = ['UNION', 'EXCEPT', 'INTERSECT']

// Statements other than SELECT that SFMC rejects at the start of a query.
const NOT_SELECT = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'EXEC', 'EXECUTE', 'DECLARE', 'SET', 'IF',
  'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'USE', 'BEGIN', 'PRINT', 'GRANT', 'WHILE',
])

// Words that end a table reference in FROM, so they are never read as an alias.
const TABLE_STOP = new Set([
  'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'ON', 'GROUP',
  'ORDER', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR', 'WITH', 'APPLY',
  'PIVOT', 'UNPIVOT', 'TABLESAMPLE', 'AS', 'INTO', 'SELECT', 'FROM', 'USING', 'WINDOW',
])

// Words that can't be the implicit alias at the end of a select item, and words
// that can't come right before one.
const ITEM_END_STOP = new Set([
  'END', 'NULL', 'AND', 'OR', 'NOT', 'ELSE', 'THEN', 'WHEN', 'CASE', 'ASC', 'DESC', 'IS',
  'IN', 'LIKE', 'BETWEEN', 'EXISTS', 'DISTINCT', 'ALL', 'TOP', 'PERCENT', 'TIES',
  'CURRENT_TIMESTAMP', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER', 'USER',
  'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'UNBOUNDED', 'ROW', 'CURRENT',
])
const BEFORE_ALIAS_STOP = new Set([
  'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'THEN', 'ELSE', 'WHEN', 'CASE', 'BETWEEN',
  'COLLATE', 'AS', 'DISTINCT', 'TOP', 'ALL', 'SELECT',
])

// Bare words in a select list that are values, not column names.
const VALUE_WORDS = new Set([
  'NULL', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_USER', 'SESSION_USER',
  'SYSTEM_USER', 'USER', 'TRUE', 'FALSE',
])

// T-SQL reserved keywords, plus DATE and TIME (ODBC reserved), which SFMC's
// query check also trips over when used as a bare alias.
const RESERVED = new Set(`ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK
BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT
COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE
CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT
DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC
EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL
FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER
INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED
NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR
ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ
READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK
ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SESSION_USER SET SETUSER SHUTDOWN SOME
STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE
TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR
WHEN WHERE WHILE WITH WITHIN WRITETEXT DATE TIME`.split(/\s+/))

const TRACKING_VIEWS = new Set(['_SENT', '_OPEN', '_CLICK', '_BOUNCE', '_COMPLAINT', '_UNSUBSCRIBE', '_JOB'])
// _Job has no EventDate; any of these narrows it down.
const JOB_FILTER_COLS = new Set(['JOBID', 'CREATEDDATE', 'SCHEDTIME', 'PICKUPTIME', 'DELIVEREDTIME', 'MODIFIEDDATE'])
const EVENT_FILTER_COLS = new Set(['EVENTDATE', 'JOBID'])

const DATA_VIEWS_UPPER = new Set([...DATA_VIEWS].map(n => n.toUpperCase()))

// Field type numbers from dataViews.js / the DE catalog.
const TEXT_TYPES = new Set([0, 4, 5])
const NUMBER_TYPES = new Set([1, 6])

const AGGREGATES = new Set(['COUNT', 'COUNT_BIG', 'SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'STDEV', 'STDEVP', 'VAR', 'VARP', 'GROUPING', 'CHECKSUM_AGG', 'APPROX_COUNT_DISTINCT'])

const FORBIDDEN_FUNCS = new Set([
  'DB_NAME', 'DB_ID', 'SERVERPROPERTY', 'DATABASEPROPERTYEX', 'OPENJSON', 'OPENROWSET',
  'OPENQUERY', 'OPENDATASOURCE', 'OPENXML', 'SUSER_NAME', 'SUSER_SNAME', 'SUSER_ID',
  'SUSER_SID', 'USER_NAME', 'USER_ID', 'HOST_NAME', 'HOST_ID', 'APP_NAME', 'ORIGINAL_LOGIN',
])
const FORBIDDEN_NILADIC = new Set(['SYSTEM_USER', 'SESSION_USER', 'CURRENT_USER'])

// ---------------------------------------------------------------------------
// Small token helpers

const isNameTok = t => t?.type === 'word' || t?.type === 'ident'
const eqi = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const span = (a, b) => ({ from: a.start, to: b.end })

/** Index of the `)` matching the `(` at sig[p], or -1. */
function matchParen(sig, p) {
  const d = sig[p].depth
  for (let q = p + 1; q < sig.length; q++) {
    if (sig[q].type === 'rparen' && sig[q].depth === d) return q
  }
  return -1
}

/** name(.name)* starting at sig[i]. */
function chainAt(sig, i) {
  if (!isNameTok(sig[i])) return null
  const parts = [sig[i]]
  let j = i
  while (sig[j + 1]?.type === 'dot' && isNameTok(sig[j + 2])) { parts.push(sig[j + 2]); j += 2 }
  return { parts, start: i, end: j }
}

/** name(.name)* ending at sig[i]. */
function chainEndingAt(sig, i) {
  if (!isNameTok(sig[i])) return null
  const parts = [sig[i]]
  let j = i
  while (sig[j - 1]?.type === 'dot' && isNameTok(sig[j - 2])) { parts.unshift(sig[j - 2]); j -= 2 }
  return { parts, start: j, end: i }
}

/** Splits sig indices [a, b) on commas at depth d. Returns arrays of [start, end] (end inclusive, may be < start when empty). */
function splitOnCommas(sig, a, b, d) {
  const out = []
  let s = a
  for (let i = a; i < b; i++) {
    if (sig[i].type === 'comma' && sig[i].depth === d) { out.push({ start: s, end: i - 1, comma: i }); s = i + 1 }
  }
  out.push({ start: s, end: b - 1, comma: -1 })
  return out
}

/** Text of a string token without quotes or N prefix. */
function stringValue(tok) {
  let v = tok.value
  if (tok.unicode) v = v.slice(1)
  v = v.slice(1, tok.unterminated ? undefined : -1)
  return v.replace(/''/g, "'")
}

// ---------------------------------------------------------------------------
// Scope building

function parseItem(sig, start, end, d) {
  const item = { start, end, exprStart: start, exprEnd: end, alias: null, aliasAs: -1, eqIdx: -1, bare: null, star: false }
  const last = sig[end]
  // expr AS alias
  if (end - start >= 2 && isWord(sig[end - 1], 'AS') && sig[end - 1].depth === d &&
      (isNameTok(last) || last.type === 'string')) {
    item.alias = last; item.aliasAs = end - 1; item.exprEnd = end - 2
  } else if (end - start >= 2 && isNameTok(sig[start]) && sig[start + 1].type === 'op' && sig[start + 1].value === '=') {
    // alias = expr (T-SQL)
    item.alias = sig[start]; item.eqIdx = start + 1; item.exprStart = start + 2
  } else if (end > start && last.depth === d &&
      (last.type === 'ident' || (last.type === 'word' && !ITEM_END_STOP.has(last.upper)))) {
    // expr alias
    const prev = sig[end - 1]
    if (prev.type !== 'dot' && prev.type !== 'op' && prev.type !== 'comma' &&
        !(prev.type === 'word' && BEFORE_ALIAS_STOP.has(prev.upper))) {
      item.alias = last; item.exprEnd = end - 1
    }
  }
  const es = item.exprStart, ee = item.exprEnd
  if (es === ee && sig[es].type === 'op' && sig[es].value === '*') {
    item.star = true
  } else {
    const ch = chainAt(sig, es)
    if (ch && (!(sig[es].type === 'word' && VALUE_WORDS.has(sig[es].upper)) || ch.parts.length > 1)) {
      if (ch.end === ee && sig[ee + 1]?.type !== 'lparen') item.bare = { parts: ch.parts }
      else if (ch.end + 2 === ee && sig[ch.end + 1].type === 'dot' && sig[ee].type === 'op' && sig[ee].value === '*') {
        item.bare = { parts: ch.parts, star: true }
      }
    }
  }
  item.outName = item.alias
    ? (item.alias.type === 'string' ? stringValue(item.alias) : identName(item.alias))
    : item.bare && !item.bare.star ? identName(item.bare.parts[item.bare.parts.length - 1]) : null
  item.nameTok = item.alias || (item.bare && !item.bare.star ? item.bare.parts[item.bare.parts.length - 1] : null)
  return item
}

function parseTableRef(sig, i, end, d) {
  const first = sig[i]
  if (!first || i >= end) return null
  let tbl, j
  if (first.type === 'lparen') {
    const q = matchParen(sig, i)
    if (q < 0) return null
    tbl = { derived: true, startIdx: i, endIdx: q }
    j = q + 1
  } else {
    const parts = []
    j = i
    while (j < end) {
      const t = sig[j]
      if (t.type === 'number' && /^\d+\.$/.test(t.value) && isNameTok(sig[j + 1])) {
        parts.push({ tok: t, name: t.value.slice(0, -1), mid: true }); j++; continue
      }
      if (!isNameTok(t)) break
      if (!parts.length && t.type === 'word' && TABLE_STOP.has(t.upper)) return null
      parts.push({ tok: t, name: identName(t) }); j++
      if (sig[j]?.type === 'dot' && j + 1 < end) { j++; continue }
      break
    }
    if (!parts.length) return null
    const last = parts[parts.length - 1]
    tbl = { name: last.name, nameTok: last.tok, nameIdx: j - 1, parts, startIdx: i, endIdx: j - 1 }
    if (sig[j]?.type === 'lparen' && j < end) {
      const q = matchParen(sig, j)
      if (q < 0) return null
      tbl.func = true; tbl.argsStart = j; tbl.endIdx = q; j = q + 1
    }
  }
  if (j < end && isWord(sig[j], 'AS') && isNameTok(sig[j + 1]) && j + 1 < end) {
    tbl.asIdx = j; tbl.alias = sig[j + 1]; j += 2
  } else if (j < end && sig[j].depth === d &&
      (sig[j].type === 'ident' || (sig[j].type === 'word' && !TABLE_STOP.has(sig[j].upper)))) {
    tbl.alias = sig[j]; j++
  }
  tbl.next = j
  return tbl
}

function parseFrom(sig, clause, d) {
  const tables = []
  const end = clause.end
  let expect = true
  let via = 'FROM'
  let openOn = null
  for (let i = clause.body; i < end;) {
    const t = sig[i]
    if (expect && t.depth === d) {
      expect = false
      const tbl = parseTableRef(sig, i, end, d)
      if (tbl) { tbl.via = via; tables.push(tbl); i = tbl.next; continue }
    }
    if (t.depth === d) {
      const joinish = t.type === 'comma' || isWord(t, 'JOIN', 'APPLY', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER')
      if (joinish && openOn) { openOn.end = i; openOn = null }
      if (t.type === 'comma') { via = ','; expect = true }
      else if (isWord(t, 'JOIN', 'APPLY')) { via = t.upper; expect = true }
      else if (isWord(t, 'ON') && tables.length) {
        openOn = { start: i + 1, end }
        tables[tables.length - 1].on = openOn
      }
    }
    i++
  }
  return tables
}

function buildScope(sig, s) {
  const d = sig[s].depth
  let end = sig.length
  for (let j = s + 1; j < sig.length; j++) {
    const t = sig[j]
    if (t.depth < d) { end = j; break }
    if (t.depth === d && (t.type === 'semi' || isWord(t, ...SET_OPS) || isWord(t, 'SELECT'))) { end = j; break }
  }

  // SELECT [ALL|DISTINCT] [TOP (n) [PERCENT] [WITH TIES]]
  let j = s + 1
  let distinct = false
  if (isWord(sig[j], 'ALL', 'DISTINCT')) { distinct = sig[j].upper === 'DISTINCT'; j++ }
  let topIdx = -1
  if (isWord(sig[j], 'TOP')) {
    topIdx = j++
    if (sig[j]?.type === 'lparen') { const q = matchParen(sig, j); j = q < 0 ? j + 1 : q + 1 }
    else if (sig[j]?.type === 'number') j++
    if (isWord(sig[j], 'PERCENT')) j++
    if (isWord(sig[j], 'WITH') && isWord(sig[j + 1], 'TIES')) j += 2
  }

  const clauses = { select: { kw: 'select', idx: s, body: Math.min(j, end), end } }
  let cur = clauses.select
  for (let k = j; k < end; k++) {
    const t = sig[k]
    if (t.depth !== d || t.type !== 'word') continue
    let kw = null, len = 1
    if (t.upper === 'FROM' && !isWord(sig[k - 1], 'DISTINCT')) kw = 'from'
    else if (t.upper === 'WHERE') kw = 'where'
    else if (t.upper === 'GROUP' && isWord(sig[k + 1], 'BY')) { kw = 'groupBy'; len = 2 }
    else if (t.upper === 'HAVING') kw = 'having'
    else if (t.upper === 'ORDER' && isWord(sig[k + 1], 'BY')) { kw = 'orderBy'; len = 2 }
    else if (t.upper === 'INTO' && cur.kw === 'select') kw = 'into'
    else if (t.upper === 'OPTION') kw = 'option'
    else if (t.upper === 'FOR' && isWord(sig[k + 1], 'JSON', 'XML', 'BROWSE')) kw = 'for'
    if (!kw || clauses[kw]) continue
    cur.end = k
    cur = clauses[kw] = { kw, idx: k, body: Math.min(k + len, end), end }
  }

  const sel = clauses.select
  const segments = sel.body < sel.end ? splitOnCommas(sig, sel.body, sel.end, d) : []
  const items = segments.filter(g => g.end >= g.start).map(g => parseItem(sig, g.start, g.end, d))
  const tables = clauses.from ? parseFrom(sig, clauses.from, d) : []
  return { idx: s, depth: d, end, clauses, segments, items, tables, topIdx, distinct }
}

function buildContext(sql, options) {
  const tokens = tokenize(sql)
  const sig = significant(tokens)
  const scopes = []
  for (let i = 0; i < sig.length; i++) if (isWord(sig[i], 'SELECT')) scopes.push(buildScope(sig, i))

  const owner = new Array(sig.length).fill(-1)
  scopes.forEach((sc, k) => {
    sc.index = k
    for (let i = sc.idx; i < sc.end; i++) owner[i] = k
    // Parent: nearest earlier scope that contains this one at a lower depth.
    for (let p = k - 1; p >= 0; p--) {
      const o = scopes[p]
      if (o.depth < sc.depth && o.idx < sc.idx && o.end > sc.idx) { sc.parent = o; break }
    }
    // UNION / EXCEPT / INTERSECT link to the previous branch.
    let op = sc.idx - 1
    if (isWord(sig[op], 'ALL')) op--
    if (isWord(sig[op], ...SET_OPS)) {
      sc.setOpIdx = op
      sc.prevBranch = scopes.find(o => o.end === op && o.depth === sc.depth)
    }
  })

  const startsWithCte = isWord(sig[0], 'WITH')
  for (const sc of scopes) {
    let fb = sc
    while (fb.prevBranch) fb = fb.prevBranch
    sc.firstBranch = fb
    if (sc.depth === 0) { sc.kind = 'top'; continue }
    sc.kind = 'sub'
    const p = fb.idx - 1
    if (sig[p]?.type !== 'lparen') continue
    const before = sig[p - 1]
    const from = sc.parent?.clauses.from
    if (isWord(before, 'FROM', 'JOIN', 'APPLY') ||
        (before?.type === 'comma' && from && p - 1 >= from.body && p - 1 < from.end)) sc.kind = 'derived'
    else if (startsWithCte && isWord(before, 'AS') && sig[p].depth === 0) sc.kind = 'cte'
  }

  // Indices of tokens that are part of a table name in FROM, so rules looking
  // for `alias.column` skip `ENT.MyDE`.
  const tableNameIdx = new Set()
  for (const sc of scopes) for (const t of sc.tables) {
    if (!t.derived) for (let i = t.startIdx; i <= t.nameIdx; i++) tableNameIdx.add(i)
  }

  return { sql, options, tokens, sig, scopes, owner, tableNameIdx, tables: options.tables || {} }
}

// Known fields of a FROM table: options.tables first, then the data views.
function fieldsFor(ctx, tbl) {
  if (!tbl || tbl.derived || tbl.func) return null
  const entry = ctx.tables[tbl.name.toLowerCase()]
  if (entry && typeof entry === 'object' && Array.isArray(entry.fields) && entry.fields.length) return entry.fields
  return DATA_VIEW_FIELDS[tbl.name.toUpperCase()] || null
}

const fieldNamed = (fields, name) => fields?.find(f => eqi(f.name, name)) || null

// The FROM table that `qual` (an alias, or a table name without alias) refers to.
function findTable(scope, qual) {
  for (let s = scope; s; s = s.parent) {
    for (const t of s.tables) {
      if (t.alias ? eqi(identName(t.alias), qual) : eqi(t.name, qual)) return t
    }
  }
  return null
}

// Field type of a column reference chain, or null when unknown.
function columnType(ctx, scope, chain) {
  const parts = chain.parts.map(identName)
  const col = parts[parts.length - 1]
  if (parts.length >= 2) {
    const f = fieldNamed(fieldsFor(ctx, findTable(scope, parts[parts.length - 2])), col)
    return f ? f.type : null
  }
  // Unqualified: only when every table in the scope is known and exactly one has it.
  const known = scope.tables.map(t => fieldsFor(ctx, t))
  if (!known.length || known.some(f => !f)) return null
  const hits = known.map(f => fieldNamed(f, col)).filter(Boolean)
  return hits.length === 1 ? hits[0].type : null
}

const tableOf = (ctx, t) => t.derived ? ctx.sig[t.startIdx] : t.nameTok
const topScopes = ctx => ctx.scopes.filter(s => s.depth === 0)
const mainScope = ctx => ctx.scopes.find(s => s.depth === 0 && !s.prevBranch) || null

// ---------------------------------------------------------------------------
// Rules

function ruleNotSelect(ctx) {
  const t = ctx.sig[0]
  if (t?.type !== 'word' || !NOT_SELECT.has(t.upper)) return []
  return [{ ...span(t, t), message: `${t.upper} is not allowed. A query activity runs one SELECT and writes its result to the target DE.` }]
}

function ruleMultipleStatements(ctx) {
  const { sig, sql } = ctx
  const out = []
  const last = sig[sig.length - 1]
  const semi = sig.findIndex(t => t.type === 'semi')
  if (semi >= 0 && sig.slice(semi + 1).some(t => t.type !== 'semi')) {
    out.push({ from: sig[semi].start, to: last.end, message: 'Only one statement is allowed. Remove the SQL after the semicolon.' })
    return out
  }
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (!isWord(t, 'GO') || t.depth !== 0) continue
    const lineStart = sql.lastIndexOf('\n', t.start - 1) + 1
    let lineEnd = sql.indexOf('\n', t.end)
    if (lineEnd < 0) lineEnd = sql.length
    if (sql.slice(lineStart, t.start).trim() === '' && /^\s*\d*\s*$/.test(sql.slice(t.end, lineEnd))) {
      out.push({ from: t.start, to: last.end, message: 'GO separates batches. A query activity runs one statement, so remove it.' })
      return out
    }
  }
  // A second SELECT at the top level with no UNION in between.
  if (!isWord(sig[0], 'SELECT', 'WITH') && sig[0]?.type !== 'lparen') return out
  let seenMain = false
  for (const sc of topScopes(ctx)) {
    if (sc.prevBranch) continue
    if (!seenMain) { seenMain = true; continue }
    if (sig[sc.idx - 1]?.type === 'lparen') continue
    out.push({ from: sig[sc.idx].start, to: last.end, message: 'A second SELECT starts here. Only one statement is allowed: join them with UNION ALL or remove one.' })
    break
  }
  return out
}

function ruleVariables(ctx) {
  return ctx.sig.filter(t => t.type === 'var').map(t => ({
    ...span(t, t), message: `Variables like ${t.value} are not supported in SFMC queries.`,
  }))
}

function ruleTempTables(ctx) {
  const out = ctx.sig.filter(t => t.type === 'temp').map(t => ({
    ...span(t, t), message: `Temp tables like ${t.value} are not supported. Use a staging DE and a second query.`,
  }))
  for (const sc of ctx.scopes) {
    const into = sc.clauses.into
    if (!into) continue
    const endTok = ctx.sig[Math.max(into.idx, into.end - 1)]
    out.push({ ...span(ctx.sig[into.idx], endTok), message: 'SELECT ... INTO is not allowed. The query activity writes to the target DE you pick.' })
  }
  return out
}

function ruleProcedures(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'word') continue
    if (i > 0 && (t.upper === 'EXEC' || t.upper === 'EXECUTE')) {
      out.push({ ...span(t, sig[i + 1] || t), message: 'Stored procedures cannot be run from a query activity.' })
    } else if (/^(SP|XP)_/.test(t.upper) && sig[i + 1]?.type === 'lparen' && sig[i - 1]?.type !== 'dot') {
      out.push({ ...span(t, t), message: `${t.value} looks like a system procedure. Procedures and user-defined functions are not available.` })
    } else if (t.upper === 'DBO' && sig[i + 1]?.type === 'dot') {
      out.push({ ...span(t, sig[i + 1]), message: 'SFMC has no dbo schema. Remove the dbo. prefix; user-defined functions are not available.' })
    }
  }
  return out
}

// WITH name AS (body) SELECT ... FROM name ...  →  SELECT ... FROM (body) AS name ...
function cteFix(ctx) {
  const { sig, sql } = ctx
  const name = sig[1]
  if (!isNameTok(name) || !isWord(sig[2], 'AS') || sig[3]?.type !== 'lparen') return null
  const close = matchParen(sig, 3)
  if (close < 0 || !isWord(sig[close + 1], 'SELECT')) return null
  const cteName = identName(name)
  const mainIdx = close + 1
  const refs = []
  for (const sc of ctx.scopes) {
    for (const t of sc.tables) {
      if (t.derived || t.func || t.parts.length !== 1 || !eqi(t.name, cteName)) continue
      if (sc.idx < mainIdx) return null // referenced inside its own body (recursive)
      refs.push(t)
    }
  }
  if (refs.length !== 1) return null
  const ref = refs[0]
  const body = sql.slice(sig[3].end, sig[close].start).trim()
  if (!body) return null
  const insert = ref.alias ? `(${body})` : `(${body}) AS ${name.value}`
  return {
    label: 'Move the CTE into the FROM clause',
    changes: [
      { from: sig[0].start, to: sig[mainIdx].start, insert: '' },
      { from: ref.nameTok.start, to: ref.nameTok.end, insert },
    ],
  }
}

function ruleCte(ctx) {
  const { sig } = ctx
  if (!isWord(sig[0], 'WITH')) return []
  const fix = cteFix(ctx)
  const endTok = isNameTok(sig[1]) ? sig[1] : sig[0]
  return [{
    ...span(sig[0], endTok),
    message: 'SFMC does not support WITH (common table expressions). Use a subquery in FROM instead.',
    ...(fix ? { fixes: [fix] } : {}),
  }]
}

const hasJoin = sc => sc.tables.length > 1 || sc.tables.some(t => t.via === 'JOIN' || t.via === 'APPLY')

function ruleSelectStarJoin(ctx) {
  const out = []
  for (const sc of topScopes(ctx)) {
    if (!hasJoin(sc)) continue
    for (const it of sc.items) {
      if (it.star) out.push({ ...span(ctx.sig[it.exprStart], ctx.sig[it.exprStart]), message: 'SELECT * with a JOIN returns the columns of every table, which gives duplicate or ambiguous names in the target DE. List the columns.' })
    }
  }
  return out
}

function ruleSelectStar(ctx) {
  const out = []
  for (const sc of topScopes(ctx)) {
    if (hasJoin(sc)) continue
    for (const it of sc.items) {
      if (it.star) out.push({ ...span(ctx.sig[it.exprStart], ctx.sig[it.exprStart]), message: 'SELECT * picks up every column. List the columns so the output matches the target DE.' })
    }
  }
  return out
}

// Scopes whose column names matter: the first branch at the top level and of derived tables.
const namedScopes = ctx => ctx.scopes.filter(s => !s.prevBranch && (s.kind === 'top' || s.kind === 'derived'))

function suggestAlias(sig, item, n, taken) {
  const f = sig[item.exprStart]
  let base = 'Column' + n
  if (f?.type === 'word' && sig[item.exprStart + 1]?.type === 'lparen' && /^[A-Za-z][A-Za-z0-9]*$/.test(f.value)) {
    base = f.value[0].toUpperCase() + f.value.slice(1).toLowerCase() + 'Result'
  } else if (isWord(f, 'CASE')) base = 'CaseResult'
  let name = base
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = base + k
  taken.add(name.toLowerCase())
  return name
}

function ruleNoAlias(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of namedScopes(ctx)) {
    const taken = new Set(sc.items.map(it => it.outName?.toLowerCase()).filter(Boolean))
    sc.items.forEach((it, n) => {
      if (it.alias || it.bare || it.star) return
      const a = sig[it.exprStart], b = sig[it.exprEnd]
      const name = suggestAlias(sig, it, n + 1, taken)
      out.push({
        ...span(a, b),
        message: 'This column has no name. Add an alias with AS so it can be written to the target DE.',
        fixes: [{ label: `Add AS ${name}`, changes: [{ from: b.end, to: b.end, insert: ` AS ${name}` }] }],
      })
    })
  }
  return out
}

function ruleDuplicateNames(ctx) {
  const sc = mainScope(ctx)
  if (!sc) return []
  const seen = new Map()
  const out = []
  for (const it of sc.items) {
    if (!it.outName) continue
    const key = it.outName.toLowerCase()
    if (seen.has(key)) {
      out.push({ ...span(it.nameTok, it.nameTok), message: `The column name ${it.outName} is used more than once. Give each column a unique alias.` })
    } else seen.set(key, it)
  }
  return out
}

function ruleEmptySelectItem(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const sel = sc.clauses.select
    if (sel.body >= sel.end) {
      out.push({ ...span(sig[sc.idx], sig[sc.idx]), message: 'The select list is empty.' })
      continue
    }
    sc.segments.forEach((g, k) => {
      if (g.end >= g.start) return
      const isLast = k === sc.segments.length - 1
      if (isLast) {
        const comma = sc.segments[k - 1].comma
        out.push({
          ...span(sig[comma], sig[comma]), message: 'Remove the comma after the last column.',
          fixes: [{ label: 'Remove the comma', changes: [{ from: sig[comma].start, to: sig[comma].end, insert: '' }] }],
        })
      } else {
        out.push({ ...span(sig[g.comma], sig[g.comma]), message: 'There is an empty column between these commas.' })
      }
    })
  }
  return out
}

function ruleOrderByInSubquery(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ob = sc.clauses.orderBy
    if (sc.depth === 0 || !ob || sc.topIdx >= 0 || sc.clauses.for) continue
    let offset = false
    for (let i = ob.body; i < ob.end; i++) if (isWord(sig[i], 'OFFSET') && sig[i].depth === sc.depth) offset = true
    if (offset) continue
    out.push({ ...span(sig[ob.idx], sig[ob.idx + 1]), message: 'ORDER BY is not allowed in a subquery unless it also has TOP or OFFSET.' })
  }
  return out
}

function ruleTopWithoutOrder(ctx) {
  return ctx.scopes.filter(sc => sc.topIdx >= 0 && !sc.clauses.orderBy).map(sc => ({
    ...span(ctx.sig[sc.topIdx], ctx.sig[sc.topIdx]),
    message: 'TOP without ORDER BY returns an arbitrary set of rows.',
  }))
}

function badNameReason(name) {
  if (name.length > 128) return 'is longer than 128 characters'
  if (/^\d+$/.test(name)) return 'is only digits'
  if (/[^A-Za-z0-9 _.-]/.test(name)) return 'has characters a DE field name cannot have (use letters, digits, spaces, _ . -)'
  return null
}

function ruleInvalidColumnName(ctx) {
  const sc = mainScope(ctx)
  if (!sc) return []
  const out = []
  for (const it of sc.items) {
    if (!it.outName) continue
    const why = badNameReason(it.outName)
    if (why) out.push({ ...span(it.nameTok, it.nameTok), message: `The column name ${it.outName.slice(0, 40)} ${why}.` })
  }
  return out
}

function ruleUnderscoreName(ctx) {
  const sc = mainScope(ctx)
  if (!sc) return []
  return sc.items.filter(it => it.outName?.startsWith('_')).map(it => ({
    ...span(it.nameTok, it.nameTok),
    message: `DE field names cannot start with an underscore. The extension renames ${it.outName} to t${it.outName} when it runs the query; add an alias to pick the name yourself.`,
  }))
}

function ruleAliasInWhere(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const aliases = new Map()
    for (const it of sc.items) {
      if (!it.alias || it.alias.type === 'string') continue
      const name = identName(it.alias)
      const bareName = it.bare && !it.bare.star ? identName(it.bare.parts[it.bare.parts.length - 1]) : null
      if (!eqi(name, bareName)) aliases.set(name.toLowerCase(), name)
    }
    // A bare output column with the same name as an alias makes it ambiguous: skip.
    for (const it of sc.items) if (it.bare && !it.alias && it.outName) aliases.delete(it.outName.toLowerCase())
    if (!aliases.size) continue
    const real = new Set()
    for (const t of sc.tables) for (const f of fieldsFor(ctx, t) || []) real.add(f.name.toLowerCase())
    for (const kw of ['where', 'groupBy', 'having']) {
      const c = sc.clauses[kw]
      if (!c) continue
      for (let i = c.body; i < c.end; i++) {
        const t = sig[i]
        if (ctx.owner[i] !== sc.index || !isNameTok(t)) continue
        if (sig[i - 1]?.type === 'dot' || sig[i + 1]?.type === 'dot' || sig[i + 1]?.type === 'lparen') continue
        const key = identName(t).toLowerCase()
        if (!aliases.has(key) || real.has(key)) continue
        const where = kw === 'groupBy' ? 'GROUP BY' : kw.toUpperCase()
        out.push({
          ...span(t, t),
          severity: kw === 'having' ? 'warning' : 'error',
          message: `${aliases.get(key)} is a column alias from the select list. ${where} runs before the select list, so repeat the expression instead.`,
        })
      }
    }
  }
  return out
}

const COMPARE_OPS = new Set(['=', '<>', '!=', '<', '>', '<=', '>=', '!<', '!>'])

function ruleTextNumberCompare(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ranges = []
    if (sc.clauses.where) ranges.push([sc.clauses.where.body, sc.clauses.where.end])
    for (const t of sc.tables) if (t.on) ranges.push([t.on.start, t.on.end])
    for (const [a, b] of ranges) {
      for (let i = a; i < b; i++) {
        const op = sig[i]
        if (op.type !== 'op' || !COMPARE_OPS.has(op.value) || ctx.owner[i] !== sc.index) continue
        const left = chainEndingAt(sig, i - 1)
        const right = chainAt(sig, i + 1)
        if (!left || !right) continue
        const before = sig[left.start - 1], after = sig[right.end + 1]
        if (before && (before.type === 'op' || before.type === 'dot')) continue
        if (after && (after.type === 'op' || after.type === 'dot' || after.type === 'lparen')) continue
        const lt = columnType(ctx, sc, left), rt = columnType(ctx, sc, right)
        if (lt == null || rt == null) continue
        const mixed = (TEXT_TYPES.has(lt) && NUMBER_TYPES.has(rt)) || (NUMBER_TYPES.has(lt) && TEXT_TYPES.has(rt))
        if (!mixed) continue
        out.push({
          from: sig[left.start].start, to: sig[right.end].end,
          message: 'This compares a text column with a number column. SQL converts the text on every row, which is slow and fails on any value that is not a number.',
        })
      }
    }
  }
  return out
}

// Word tokens that follow a table name with only whitespace in between.
function tableNameRun(ctx, start, end) {
  const { sig, sql } = ctx
  const run = [start]
  for (let j = start + 1; j < end; j++) {
    const prev = sig[j - 1], t = sig[j]
    if (sql.slice(prev.end, t.start).trim() !== '') break
    if (t.type === 'op' && t.value === '-') {
      if (prev.end !== t.start || !sig[j + 1] || sig[j + 1].start !== t.end) break
      run.push(j); continue
    }
    if (t.type === 'number' && prev.type === 'op') { run.push(j); continue }
    if (t.type !== 'word' || TABLE_STOP.has(t.upper)) break
    run.push(j)
  }
  while (run.length && sig[run[run.length - 1]].type === 'op') run.pop()
  return run
}

function ruleUnbracketedName(ctx) {
  const { sig, sql } = ctx
  const out = []
  const known = name => Object.prototype.hasOwnProperty.call(ctx.tables, name.toLowerCase()) && typeof ctx.tables[name.toLowerCase()] === 'object'
  for (const sc of ctx.scopes) {
    const from = sc.clauses.from
    for (const t of sc.tables) {
      if (t.derived || t.func || t.nameTok.type !== 'word') continue
      const run = tableNameRun(ctx, t.nameIdx, from.end)
      if (run.length < 2) continue
      const text = k => sql.slice(sig[run[0]].start, sig[run[k]].end)
      let k = -1
      // Longest prefix that names a known DE.
      for (let n = run.length - 1; n >= 1; n--) {
        if (sig[run[n]].type !== 'op' && known(text(n).replace(/\s+/g, ' '))) { k = n; break }
      }
      if (k < 0 && known(t.name)) continue
      if (k < 0) {
        // A hyphenated name, or three or more bare words (never valid SQL).
        let h = 0
        while (h + 2 < run.length && sig[run[h + 1]].type === 'op') h += 2
        if (h > 0) k = h
        else if (run.length >= 3) k = run.length - 1
      }
      if (k < 0) continue
      const a = sig[run[0]], b = sig[run[k]]
      const name = sql.slice(a.start, b.end)
      out.push({
        ...span(a, b), message: `Put ${name.replace(/\s+/g, ' ')} in brackets: names with spaces or hyphens must be written as [Name].`,
        fixes: [{ label: 'Add brackets', changes: [{ from: a.start, to: b.end, insert: bracket(name) }] }],
      })
    }
  }
  return out
}

function ruleReservedAlias(ctx) {
  const out = []
  const check = tok => {
    if (tok?.type !== 'word' || !RESERVED.has(tok.upper)) return
    out.push({
      ...span(tok, tok), message: `${tok.value} is a reserved word. Put it in brackets: [${tok.value}].`,
      fixes: [{ label: `Use [${tok.value}]`, changes: [{ from: tok.start, to: tok.end, insert: bracket(tok.value) }] }],
    })
  }
  for (const sc of ctx.scopes) {
    for (const it of sc.items) if (it.aliasAs >= 0) check(it.alias)
    for (const t of sc.tables) if (t.asIdx != null) check(t.alias)
  }
  return out
}

function ruleMidPrefix(ctx) {
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (t.derived || t.parts.length < 2) continue
    const p = t.parts[0]
    if (!p.mid && !/^\d+$/.test(p.name)) continue
    const fix = ctx.options.isParentBU ? null : {
      label: 'Use ENT.', changes: [{ from: p.tok.start, to: t.parts[1].tok.start, insert: 'ENT.' }],
    }
    out.push({
      from: p.tok.start, to: t.nameTok.end,
      message: `SFMC does not accept a MID prefix. Use ENT.${t.name} for a DE shared from the parent BU.`,
      ...(fix ? { fixes: [fix] } : {}),
    })
  }
  return out
}

function ruleEqualsNull(ctx) {
  const { sig } = ctx
  const aliasEq = new Set()
  for (const sc of ctx.scopes) for (const it of sc.items) if (it.eqIdx >= 0) aliasEq.add(it.eqIdx)
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const op = sig[i]
    if (op.type !== 'op' || !['=', '<>', '!='].includes(op.value) || !isWord(sig[i + 1], 'NULL') || aliasEq.has(i)) continue
    const insert = op.value === '=' ? 'IS NULL' : 'IS NOT NULL'
    out.push({
      ...span(op, sig[i + 1]), message: `Nothing equals NULL, so this is never true. Use ${insert}.`,
      fixes: [{ label: `Use ${insert}`, changes: [{ from: op.start, to: sig[i + 1].end, insert }] }],
    })
  }
  return out
}

function ruleNotInSubquery(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (isWord(sig[i], 'NOT') && isWord(sig[i + 1], 'IN') && sig[i + 2]?.type === 'lparen' && isWord(sig[i + 3], 'SELECT')) {
      out.push({ ...span(sig[i], sig[i + 1]), message: 'NOT IN (SELECT ...) returns no rows at all if the subquery returns a NULL. NOT EXISTS is safer.' })
    }
  }
  return out
}

function ruleLikeNoWildcard(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const like = sig[i], pat = sig[i + 1]
    if (!isWord(like, 'LIKE') || pat?.type !== 'string' || pat.unterminated || isWord(sig[i + 2], 'ESCAPE')) continue
    if (/[%_[]/.test(stringValue(pat))) continue
    const not = isWord(sig[i - 1], 'NOT') ? sig[i - 1] : null
    const insert = not ? '<>' : '='
    out.push({
      ...span(not || like, pat), message: `This LIKE pattern has no % or _ wildcard, so it is an exact match. Use ${insert}.`,
      fixes: [{ label: `Use ${insert}`, changes: [{ from: (not || like).start, to: like.end, insert }] }],
    })
  }
  return out
}

// Words that end an expression, so a + after them starts a new chain.
const CHAIN_BREAK = new Set(['AS', 'FROM', 'WHERE', 'AND', 'OR', 'THEN', 'ELSE', 'WHEN', 'END', 'ON', 'SELECT', 'CASE', 'IN', 'LIKE', 'IS', 'NOT'])

function rulePlusConcat(ctx) {
  const { sig } = ctx
  const out = []
  let lastIdx = -1
  for (let i = 0; i < sig.length; i++) {
    const op = sig[i]
    if (op.type !== 'op' || op.value !== '+') continue
    if (sig[i - 1]?.type !== 'string' && sig[i + 1]?.type !== 'string') continue
    // Merge a chain like 'a' + x + 'b' into one diagnostic.
    if (lastIdx >= 0 && out.length && sig.slice(lastIdx + 1, i).every(t => t.depth >= op.depth && t.type !== 'comma' && !(t.type === 'word' && CHAIN_BREAK.has(t.upper)))) {
      out[out.length - 1].to = op.end
    } else {
      out.push({ ...span(op, op), message: 'Joining strings with + gives NULL if any part is NULL. CONCAT() treats NULL as an empty string.' })
    }
    lastIdx = i
  }
  return out
}

function ruleServerTime(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    let end = null
    if (isWord(t, 'GETDATE', 'SYSDATETIME', 'SYSDATETIMEOFFSET') && sig[i + 1]?.type === 'lparen' && sig[i + 2]?.type === 'rparen') end = sig[i + 2]
    else if (isWord(t, 'CURRENT_TIMESTAMP')) end = t
    if (!end || sig[i - 1]?.type === 'dot') continue
    const next = sig[sig.indexOf(end) + 1]
    if (isWord(next, 'AT')) continue
    out.push({ ...span(t, end), message: `${t.upper === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : t.upper + '()'} returns SFMC server time: US Central Standard Time (UTC-6) all year, with no daylight saving.` })
  }
  return out
}

function ruleCentralTimeZone(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (!isWord(sig[i], 'AT') || !isWord(sig[i + 1], 'TIME') || !isWord(sig[i + 2], 'ZONE')) continue
    const z = sig[i + 3]
    if (z?.type !== 'string' || stringValue(z).trim().toLowerCase() !== 'central standard time') continue
    // Second step of x AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time': a real conversion, fine.
    if (sig[i - 1]?.type === 'string' && isWord(sig[i - 2], 'ZONE')) continue
    out.push({
      ...span(sig[i], z),
      message: "SFMC server time has no daylight saving, but 'Central Standard Time' does, so this is an hour off for half the year. 'Central America Standard Time' is UTC-6 all year.",
      fixes: [{ label: "Use 'Central America Standard Time'", changes: [{ from: z.start, to: z.end, insert: "'Central America Standard Time'" }] }],
    })
  }
  return out
}

function ruleDecimalPrecision(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (!isWord(t, 'DECIMAL', 'NUMERIC', 'DEC') || sig[i + 1]?.type === 'lparen') continue
    const inCast = isWord(sig[i - 1], 'AS') && t.depth > 0 && sig[i + 1]?.type === 'rparen'
    const inConvert = sig[i - 1]?.type === 'lparen' && isWord(sig[i - 2], 'CONVERT', 'TRY_CONVERT')
    if (!inCast && !inConvert) continue
    out.push({
      ...span(t, t), message: `${t.upper} with no precision and scale is ${t.upper}(18,0), which drops the decimal part. Give both, for example ${t.upper}(18,2).`,
      fixes: [{ label: `Use ${t.upper}(18,2)`, changes: [{ from: t.end, to: t.end, insert: '(18,2)' }] }],
    })
  }
  return out
}

const normChain = parts => parts.map(p => identName(p).toLowerCase()).join('.')

function ruleNotGrouped(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const gb = sc.clauses.groupBy
    if (!gb) continue
    let complex = false
    for (let i = gb.body; i < gb.end; i++) if (isWord(sig[i], 'ROLLUP', 'CUBE', 'GROUPING')) complex = true
    if (complex) continue
    const full = new Set(), last = new Set()
    for (const g of splitOnCommas(sig, gb.body, gb.end, sc.depth)) {
      const ch = chainAt(sig, g.start)
      if (!ch || ch.end !== g.end) continue
      full.add(normChain(ch.parts))
      last.add(identName(ch.parts[ch.parts.length - 1]).toLowerCase())
    }
    for (const it of sc.items) {
      if (!it.bare || it.bare.star) continue
      const f = normChain(it.bare.parts)
      const l = identName(it.bare.parts[it.bare.parts.length - 1]).toLowerCase()
      if (full.has(f) || full.has(l) || (it.bare.parts.length === 1 && last.has(l))) continue
      out.push({ from: sig[it.exprStart].start, to: sig[it.exprEnd].end, message: `${sig.slice(it.exprStart, it.exprEnd + 1).map(t => t.value).join('')} is not in GROUP BY and not inside an aggregate like MAX().` })
    }
  }
  return out
}

function hasFilterOn(ctx, start, end, qual, cols) {
  const { sig } = ctx
  for (let i = start; i < end; i++) {
    const t = sig[i]
    if (!isNameTok(t) || !cols.has(identName(t).toUpperCase())) continue
    if (sig[i + 1]?.type === 'dot') continue
    if (sig[i - 1]?.type !== 'dot') return true
    if (eqi(identName(sig[i - 2]), qual)) return true
  }
  return false
}

function ruleTrackingNoFilter(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    for (const t of sc.tables) {
      if (t.derived || t.func) continue
      const up = t.name.toUpperCase()
      if (!TRACKING_VIEWS.has(up)) continue
      const qual = t.alias ? identName(t.alias) : t.name
      const cols = up === '_JOB' ? JOB_FILTER_COLS : EVENT_FILTER_COLS
      const where = sc.clauses.where
      if (where && hasFilterOn(ctx, where.body, where.end, qual, cols)) continue
      if (t.on && hasFilterOn(ctx, t.on.start, t.on.end, qual, cols)) continue
      const d = {
        ...span(sig[t.startIdx], t.nameTok),
        message: up === '_JOB'
          ? `${t.name} has no filter on JobID or a date in WHERE. Large tracking views can hit the 30-minute query timeout.`
          : `${t.name} has no filter on EventDate or JobID in WHERE. Tracking views are large and can hit the 30-minute query timeout.`,
      }
      if (up !== '_JOB') {
        const q = (t.alias || t.nameTok).value
        const filter = `${q}.EventDate >= DATEADD(DAY, -30, GETDATE())`
        let changes
        if (!where) {
          const endTok = sig[sc.clauses.from.end - 1]
          changes = [{ from: endTok.end, to: endTok.end, insert: ` WHERE ${filter}` }]
        } else if (where.body < where.end) {
          changes = [
            { from: sig[where.body].start, to: sig[where.body].start, insert: `${filter} AND (` },
            { from: sig[where.end - 1].end, to: sig[where.end - 1].end, insert: ')' },
          ]
        }
        if (changes) d.fixes = [{ label: 'Add a 30-day EventDate filter', changes }]
      }
      out.push(d)
    }
  }
  return out
}

function ruleTrackingJoinNoJobId(ctx) {
  const { sig } = ctx
  const out = []
  const tracking = t => !t.derived && !t.func && TRACKING_VIEWS.has(t.name.toUpperCase())
  for (const sc of ctx.scopes) {
    sc.tables.forEach((t, k) => {
      if (k === 0 || t.via !== 'JOIN' || !t.on || !tracking(t) || !sc.tables.slice(0, k).some(tracking)) return
      for (let i = t.on.start; i < t.on.end; i++) if (isNameTok(sig[i]) && eqi(identName(sig[i]), 'JobID')) return
      out.push({ ...span(sig[t.startIdx], t.nameTok), message: `Join ${t.name} on JobID as well as the subscriber. Without it the join matches every send to that subscriber and runs slowly.` })
    })
  }
  return out
}

function ruleTargetAsSource(ctx) {
  const target = (ctx.options.targetName || '').trim().replace(/^ent\./i, '').replace(/^\[(.*)\]$/, '$1')
  if (!target) return []
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (t.derived || t.func || !eqi(t.name, target)) continue
    out.push({ ...span(sig0(ctx, t), t.nameTok), message: `${t.name} is the target DE of this query. A query cannot read from its own target DE.` })
  }
  return out
}
const sig0 = (ctx, t) => ctx.sig[t.startIdx]

function ruleUnionColumnCount(ctx) {
  const out = []
  for (const sc of ctx.scopes) {
    const prev = sc.prevBranch
    if (!prev) continue
    const starry = s => s.items.some(it => it.star || it.bare?.star)
    if (starry(sc) || starry(prev) || !sc.items.length || !prev.items.length) continue
    if (sc.items.length === prev.items.length) continue
    const op = ctx.sig[sc.setOpIdx]
    out.push({ ...span(op, op), message: `The queries on each side of ${op.upper} have ${prev.items.length} and ${sc.items.length} columns. They need the same number.` })
  }
  return out
}

function ruleUnionAll(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (isWord(sig[i], 'UNION') && !isWord(sig[i + 1], 'ALL')) {
      out.push({ ...span(sig[i], sig[i]), message: 'UNION removes duplicate rows, which costs a sort. Use UNION ALL when duplicates are fine or impossible.' })
    }
  }
  return out
}

function ruleUnbalanced(ctx) {
  const out = []
  for (const t of ctx.tokens) {
    if (!t.unterminated) continue
    const what = t.type === 'string' ? 'This string is missing its closing quote.'
      : t.type === 'comment' ? 'This comment is missing its closing */.'
      : t.bracket ? 'This name is missing its closing ].' : 'This name is missing its closing ".'
    out.push({ from: t.start, to: t.end, message: what })
  }
  const stack = []
  for (const t of ctx.sig) {
    if (t.type === 'lparen') stack.push(t)
    else if (t.type === 'rparen') {
      if (stack.length) stack.pop()
      else out.push({ ...span(t, t), message: 'This ) has no matching (.' })
    }
  }
  for (const t of stack) out.push({ ...span(t, t), message: 'This ( is never closed.' })
  // A ] outside any [name] (brackets inside names are already tokens).
  for (const t of ctx.sig) if (t.type === 'op' && t.value === ']') out.push({ ...span(t, t), message: 'This ] has no matching [.' })
  return out
}

function ruleUnknownColumn(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 2; i < sig.length; i++) {
    const t = sig[i]
    if (!isNameTok(t) || sig[i - 1].type !== 'dot' || !isNameTok(sig[i - 2])) continue
    if (sig[i + 1]?.type === 'dot' || sig[i + 1]?.type === 'lparen' || ctx.tableNameIdx.has(i)) continue
    const sc = ctx.scopes[ctx.owner[i]]
    if (!sc) continue
    const qual = identName(sig[i - 2])
    const tbl = findTable(sc, qual)
    const fields = fieldsFor(ctx, tbl)
    if (!fields || fieldNamed(fields, identName(t))) continue
    out.push({ ...span(t, t), message: `${tbl.name} has no field named ${identName(t)}.` })
  }
  return out
}

// With a complete DE list (`tables.__complete`), any other table is unknown. The
// editor has no complete list: it passes `tables.__missing`, the names its exact-name
// DE lookup confirmed don't exist, and only those are flagged.
function ruleUnknownTable(ctx) {
  const complete = ctx.tables.__complete === true
  const missing = ctx.tables.__missing instanceof Set ? ctx.tables.__missing : null
  if (!complete && !missing?.size) return []
  const cteNames = new Set()
  if (isWord(ctx.sig[0], 'WITH')) {
    for (let i = 1; i < ctx.sig.length; i++) {
      if (isNameTok(ctx.sig[i]) && ctx.sig[i].depth === 0 && isWord(ctx.sig[i + 1], 'AS') && ctx.sig[i + 2]?.type === 'lparen') cteNames.add(identName(ctx.sig[i]).toLowerCase())
    }
  }
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (t.derived || t.func) continue
    const key = t.name.toLowerCase()
    if (DATA_VIEWS_UPPER.has(t.name.toUpperCase()) || cteNames.has(key)) continue
    if (ctx.tables[key] && typeof ctx.tables[key] === 'object') continue
    // ENT.X and other qualified names live outside this BU's DE search.
    if (!complete && (t.parts?.length > 1 || !missing.has(key))) continue
    out.push({ ...span(sig0(ctx, t), t.nameTok), message: `No data extension named ${t.name} was found in this business unit.` })
  }
  return out
}

function ruleForbiddenFunction(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'word' || sig[i - 1]?.type === 'dot') continue
    if (FORBIDDEN_FUNCS.has(t.upper) && sig[i + 1]?.type === 'lparen') {
      out.push({ ...span(t, t), message: `${t.upper}() is not available in SFMC queries.` })
    } else if (FORBIDDEN_NILADIC.has(t.upper)) {
      out.push({ ...span(t, t), message: `${t.upper} is not available in SFMC queries.` })
    }
  }
  return out
}

function ruleEntInParent(ctx) {
  if (!ctx.options.isParentBU) return []
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (t.derived || t.parts.length < 2 || !eqi(t.parts[0].name, 'ENT')) continue
    const ent = t.parts[0].tok
    out.push({
      from: ent.start, to: t.nameTok.end, message: 'ENT. is for reaching the parent BU from a child BU. In the parent BU, drop the prefix.',
      fixes: [{ label: 'Remove ENT.', changes: [{ from: ent.start, to: t.parts[1].tok.start, insert: '' }] }],
    })
  }
  return out
}

function ruleFromInsideExpression(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (isWord(t, 'FROM') && t.depth > 0) {
      let k = i - 1
      while (k >= 0 && !(sig[k].type === 'lparen' && sig[k].depth === t.depth - 1)) k--
      if (k > 0 && isWord(sig[k - 1], 'TRIM') && !isWord(sig[k + 1], 'SELECT')) {
        const q = matchParen(sig, k)
        out.push({ ...span(sig[k - 1], q < 0 ? t : sig[q]), message: "SFMC's query check reads FROM inside TRIM() as the start of the table list. Use LTRIM(RTRIM(...)) or REPLACE() instead." })
      }
    }
    if (isWord(t, 'DISTINCT') && isWord(sig[i + 1], 'FROM')) {
      const is = isWord(sig[i - 1], 'IS') ? sig[i - 1] : isWord(sig[i - 1], 'NOT') && isWord(sig[i - 2], 'IS') ? sig[i - 2] : null
      if (is) out.push({ ...span(is, sig[i + 1]), message: "SFMC's query check reads this FROM as the start of the table list. Compare with = or <> and handle NULL with IS NULL." })
    }
  }
  return out
}

function ruleTvfArgs(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (!t.func) continue
    const d = sig[t.argsStart].depth + 1
    let commas = 0
    for (let i = t.argsStart + 1; i < t.endIdx; i++) if (sig[i].type === 'comma' && sig[i].depth === d) commas++
    if (commas) out.push({ ...span(sig[t.startIdx], sig[t.endIdx]), message: `SFMC rejects table-valued functions with more than one argument, such as ${t.name}(...).` })
  }
  return out
}

function ruleUnicodeLiteral(ctx) {
  return ctx.sig.filter(t => t.type === 'string' && t.unicode).map(t => ({
    ...span(t, t), message: "SFMC rejects N'...' strings. Use a plain '...' string; DE text fields already hold Unicode.",
    fixes: [{ label: 'Remove the N prefix', changes: [{ from: t.start, to: t.start + 1, insert: '' }] }],
  }))
}

function ruleCommentApostrophe(ctx) {
  const out = []
  for (const t of ctx.tokens) {
    if (t.type !== 'comment') continue
    const n = (t.value.match(/'/g) || []).length
    if (n % 2 === 0) continue
    out.push({
      ...span(t, t), message: "This comment has an odd number of apostrophes. SFMC's query check reads it as an open string.",
      fixes: [{ label: 'Remove the apostrophes', changes: [{ from: t.start, to: t.end, insert: t.value.replace(/'/g, '') }] }],
    })
  }
  return out
}

function ruleForJson(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (isWord(sig[i], 'FOR') && sig[i].depth === 0 && isWord(sig[i + 1], 'JSON', 'XML')) {
      out.push({ ...span(sig[i], sig[i + 1]), message: `FOR ${sig[i + 1].upper} returns one column with no name. Wrap it in a subquery with an alias: SELECT (SELECT ... FOR ${sig[i + 1].upper} PATH) AS Result.` })
    }
  }
  return out
}

function ruleOrderByNumber(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ob = sc.clauses.orderBy
    if (!ob) continue
    for (const g of splitOnCommas(sig, ob.body, ob.end, sc.depth)) {
      const t = sig[g.start]
      if (t?.type !== 'number' || g.end < g.start) continue
      if (g.end === g.start || (g.end === g.start + 1 && isWord(sig[g.end], 'ASC', 'DESC'))) {
        out.push({ ...span(t, t), message: `ORDER BY ${t.value} sorts by column position, which changes silently when the select list changes. Use the column name.` })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Rules from the MCE SQL error list (2026-10-25; facts from SFMC's own error messages)

// QS045: SFMC wraps the query, so a top-level ORDER BY needs TOP like a subquery's.
function ruleOrderByTopLevel(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ob = sc.clauses.orderBy
    if (sc.depth !== 0 || !ob || sc.topIdx >= 0 || sc.clauses.for) continue
    // A UNION's ORDER BY belongs to the whole query; it needs TOP in no branch either.
    let offset = false
    for (let i = ob.body; i < ob.end; i++) if (isWord(sig[i], 'OFFSET') && sig[i].depth === 0) offset = true
    if (offset) continue
    const last = sig[ob.end - 1]
    out.push({
      ...span(sig[ob.idx], sig[ob.idx + 1]),
      message: 'ORDER BY without TOP is refused: SFMC runs the query as a subquery. A data extension keeps no order anyway; remove ORDER BY or add TOP.',
      fixes: last ? [{ label: 'Remove ORDER BY', changes: [{ from: sig[ob.idx].start, to: last.end, insert: '' }] }] : undefined,
    })
  }
  return out
}

// QS046: FROM a, b (old style join).
function ruleCommaJoin(ctx) {
  const out = []
  for (const sc of ctx.scopes) for (const t of sc.tables) {
    if (t.via !== ',' || t.func) continue
    const tok = t.derived ? ctx.sig[t.startIdx] : t.nameTok
    out.push({ ...span(tok, tok), message: 'Tables separated by commas in FROM (old style join) are refused by SFMC. Use JOIN ... ON.' })
  }
  return out
}

// QS047: syntax from other databases.
function ruleOtherDialect(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (isWord(t, 'LIMIT') && sig[i + 1]?.type === 'number') {
      out.push({ ...span(t, sig[i + 1]), message: 'LIMIT is not SQL Server syntax: use SELECT TOP n.' })
    } else if (t.type === 'op' && t.value === '|' && sig[i + 1]?.type === 'op' && sig[i + 1].value === '|' && sig[i + 1].start === t.end) {
      out.push({ ...span(t, sig[i + 1]), message: '|| is not string concatenation in SQL Server: use + or CONCAT().', fixes: [{ label: 'Use +', changes: [{ from: t.start, to: sig[i + 1].end, insert: '+' }] }] })
    } else if (isWord(t, 'CURRENT_DATE') && sig[i - 1]?.type !== 'dot') {
      out.push({ ...span(t, t), message: 'CURRENT_DATE does not exist in SFMC: use CAST(GETDATE() AS DATE).', fixes: [{ label: 'Use CAST(GETDATE() AS DATE)', changes: [{ from: t.start, to: t.end, insert: 'CAST(GETDATE() AS DATE)' }] }] })
    } else if (isWord(t, 'ILIKE')) {
      out.push({ ...span(t, t), message: 'ILIKE is PostgreSQL: LIKE in SFMC already ignores case.', fixes: [{ label: 'Use LIKE', changes: [{ from: t.start, to: t.end, insert: 'LIKE' }] }] })
    } else if (t.type === 'op' && t.value === '::') {
      out.push({ ...span(t, t), message: ':: casting is PostgreSQL: use CAST(x AS type).' })
    } else if (t.type === 'op' && t.value === '`') {
      out.push({ ...span(t, t), message: 'Backticks are MySQL quoting: use [brackets].' })
    } else if (isWord(t, 'WINDOW') && t.depth === 0 && isNameTok(sig[i + 1]) && isWord(sig[i + 2], 'AS')) {
      out.push({ ...span(t, t), message: 'A named WINDOW clause is not available in SFMC: write the OVER (...) in full.' })
    }
  }
  return out
}

// QS048: functions from other databases, with the SQL Server name.
const OTHER_FUNCS = {
  NOW: ['GETDATE', true], SYSDATE: ['GETDATE', true], CURDATE: ['CAST(GETDATE() AS DATE)', false], LOCALTIMESTAMP: ['GETDATE', true],
  IFNULL: ['ISNULL', true], NVL: ['ISNULL', true], NVL2: ['IIF(x IS NOT NULL, a, b)', false],
  SUBSTR: ['SUBSTRING', true], LENGTH: ['LEN', true], CHAR_LENGTH: ['LEN', true], INSTR: ['CHARINDEX (arguments swapped)', false],
  LOCATE: ['CHARINDEX', true], STRPOS: ['CHARINDEX (arguments swapped)', false], LCASE: ['LOWER', true], UCASE: ['UPPER', true],
  DATE_TRUNC: ['DATEADD/DATEDIFF, or CAST(x AS DATE) for days', false], DATETRUNC: ['DATEADD/DATEDIFF, or CAST(x AS DATE) for days', false],
  DATE_ADD: ['DATEADD', false], DATE_SUB: ['DATEADD with a negative number', false], DATE_FORMAT: ['FORMAT or CONVERT with a style', false],
  TO_CHAR: ['FORMAT or CONVERT', false], TO_DATE: ['CONVERT(DATETIME, x, style)', false], STRFTIME: ['FORMAT', false],
  GROUP_CONCAT: ['STRING_AGG', false], LISTAGG: ['STRING_AGG', false], REGEXP_LIKE: ['LIKE with a pattern', false],
  GREATEST: ['a CASE expression (GREATEST is newer than SFMC\'s SQL Server)', false], LEAST: ['a CASE expression (LEAST is newer than SFMC\'s SQL Server)', false],
  GENERATE_SERIES: ['a numbers table or a recursive pattern (not available)', false], JSON_OBJECT: ['string building with CONCAT (JSON_OBJECT is newer than SFMC\'s SQL Server)', false],
  JSON_ARRAY: ['string building with CONCAT', false], RANDOM: ['NEWID() for ordering, or RAND()', false],
}
function ruleOtherFunctions(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'word' || sig[i - 1]?.type === 'dot' || sig[i + 1]?.type !== 'lparen') continue
    const hit = OTHER_FUNCS[t.upper]
    if (!hit) continue
    const [use, rename] = hit
    const d = { ...span(t, t), message: `${t.upper}() is not a function in SFMC's SQL: use ${use}.` }
    if (rename) d.fixes = [{ label: `Use ${use}`, changes: [{ from: t.start, to: t.end, insert: use }] }]
    out.push(d)
  }
  return out
}

// QS049: alias.column where the alias is not in FROM (multi-part identifier could not be bound).
function ruleUnknownAlias(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i + 2 < sig.length; i++) {
    const t = sig[i]
    if (!isNameTok(t) || sig[i + 1]?.type !== 'dot' || !isNameTok(sig[i + 2])) continue
    if (sig[i - 1]?.type === 'dot' || sig[i + 3]?.type === 'dot' || sig[i + 3]?.type === 'lparen') continue
    if (ctx.tableNameIdx.has(i)) continue
    const sc = ctx.scopes[ctx.owner[i]]
    if (!sc || !sc.tables.length) continue
    // Skip anything outside SELECT/WHERE/GROUP/HAVING/ORDER/ON (INTO, OPTION, ...).
    if (sc.clauses.into && i >= sc.clauses.into.idx && i < sc.clauses.into.end) continue
    const qual = identName(t)
    if (findTable(sc, qual)) continue
    // Unaliased qualified names (ENT.X, a.b.c) are handled by other rules.
    if (eqi(qual, 'ENT') || eqi(qual, 'dbo')) continue
    out.push({ ...span(t, t), message: `${qual} is not a table or alias in this FROM (SFMC: "The multi-part identifier could not be bound").` })
  }
  return out
}

// QS050: the same alias (or unaliased table) twice in one FROM.
function ruleDuplicateAlias(ctx) {
  const out = []
  for (const sc of ctx.scopes) {
    const seen = new Map()
    for (const t of sc.tables) {
      const name = t.alias ? identName(t.alias) : (t.derived ? null : t.name)
      if (!name) continue
      const k = name.toLowerCase()
      if (seen.has(k)) {
        const tok = t.alias || t.nameTok
        out.push({ ...span(tok, tok), message: `${name} is used twice in this FROM: give each table its own alias.` })
      } else seen.set(k, t)
    }
  }
  return out
}

/** sig indices of OVER keywords with their (start, end) paren range. */
function overClauses(sig) {
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (!isWord(sig[i], 'OVER') || sig[i + 1]?.type !== 'lparen') continue
    const q = matchParen(sig, i + 1)
    if (q > 0) out.push({ idx: i, open: i + 1, close: q })
  }
  return out
}

/** The function call just before OVER: { name, nameIdx, open, close }. */
function callBefore(sig, overIdx) {
  const close = overIdx - 1
  if (sig[close]?.type !== 'rparen') return null
  for (let p = close - 1; p >= 0; p--) {
    if (sig[p].type === 'lparen' && sig[p].depth === sig[close].depth && matchParen(sig, p) === close) {
      return sig[p - 1]?.type === 'word' ? { name: sig[p - 1].upper, nameIdx: p - 1, open: p, close } : null
    }
  }
  return null
}

function inClause(sc, kw, i) {
  const c = sc.clauses[kw]
  return !!c && i >= c.body && i < c.end
}

// QS051: OVER (...) in WHERE, GROUP BY or HAVING.
function ruleWindowPlacement(ctx) {
  const { sig } = ctx
  const out = []
  for (const o of overClauses(sig)) {
    const sc = ctx.scopes[ctx.owner[o.idx]]
    if (!sc) continue
    const where = ['where', 'groupBy', 'having'].find((k) => inClause(sc, k, o.idx))
    if (!where) continue
    const label = { where: 'WHERE', groupBy: 'GROUP BY', having: 'HAVING' }[where]
    out.push({ ...span(sig[o.idx], sig[o.close]), message: `Window functions (OVER) can only be in SELECT or ORDER BY, not ${label}. Compute it in a subquery and filter on its alias outside.` })
  }
  return out
}

const RANKING = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'CUME_DIST', 'PERCENT_RANK'])
const NEED_ORDER = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'CUME_DIST', 'PERCENT_RANK'])
const NO_FRAME = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'CUME_DIST', 'PERCENT_RANK'])

// QS052 / QS053: window function rules.
function ruleWindowDistinct(ctx) {
  const { sig } = ctx
  const out = []
  for (const o of overClauses(sig)) {
    const call = callBefore(sig, o.idx)
    if (!call || !AGGREGATES.has(call.name)) continue
    if (isWord(sig[call.open + 1], 'DISTINCT')) out.push({ ...span(sig[call.nameIdx], sig[o.close]), message: `${call.name}(DISTINCT ...) OVER (...) is refused: DISTINCT is not allowed in a window function. Use a subquery, or DENSE_RANK tricks.` })
  }
  return out
}

function ruleWindowShape(ctx) {
  const { sig } = ctx
  const out = []
  for (const o of overClauses(sig)) {
    const call = callBefore(sig, o.idx)
    if (!call) continue
    const d = sig[o.open].depth + 1
    let order = false
    let frame = -1
    for (let i = o.open + 1; i < o.close; i++) {
      if (sig[i].depth !== d) continue
      if (isWord(sig[i], 'ORDER') && isWord(sig[i + 1], 'BY')) order = true
      if (isWord(sig[i], 'ROWS', 'RANGE') && frame < 0) frame = i
    }
    const at = span(sig[call.nameIdx], sig[o.close])
    if (call.name === 'STRING_AGG') out.push({ ...at, message: 'STRING_AGG cannot be a window function (no OVER): use it with GROUP BY.' })
    else if (NEED_ORDER.has(call.name) && !order) out.push({ ...at, message: `${call.name}() needs ORDER BY inside OVER (...).` })
    else if (NO_FRAME.has(call.name) && frame >= 0) out.push({ ...at, message: `${call.name}() cannot have a ROWS or RANGE frame.` })
    else if (frame >= 0 && !order) out.push({ ...at, message: 'A ROWS or RANGE frame needs ORDER BY inside OVER (...).' })
    else if (frame >= 0 && isWord(sig[frame], 'RANGE')) {
      for (let i = frame + 1; i < o.close; i++) {
        if (sig[i].type === 'number' && isWord(sig[i + 1], 'PRECEDING', 'FOLLOWING')) {
          out.push({ ...at, message: 'RANGE only takes UNBOUNDED or CURRENT ROW: use ROWS for a number of rows.' })
          break
        }
      }
    }
  }
  // PERCENTILE_CONT / PERCENTILE_DISC need WITHIN GROUP and OVER.
  for (let i = 0; i < sig.length; i++) {
    if (!isWord(sig[i], 'PERCENTILE_CONT', 'PERCENTILE_DISC') || sig[i + 1]?.type !== 'lparen') continue
    const q = matchParen(sig, i + 1)
    if (q < 0) continue
    let j = q + 1
    if (isWord(sig[j], 'WITHIN') && sig[j + 2]?.type === 'lparen') j = matchParen(sig, j + 2) + 1
    if (j > 0 && !isWord(sig[j], 'OVER')) out.push({ ...span(sig[i], sig[q]), message: `${sig[i].upper} needs OVER (...) in SQL Server (an empty OVER () works).` })
  }
  return out
}

// QS054: aggregates in WHERE, and an aggregate inside another.
function ruleAggregatePlacement(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'word' || !AGGREGATES.has(t.upper) || sig[i + 1]?.type !== 'lparen' || sig[i - 1]?.type === 'dot') continue
    const sc = ctx.scopes[ctx.owner[i]]
    if (!sc) continue
    const q = matchParen(sig, i + 1)
    if (q > 0 && isWord(sig[q + 1], 'OVER')) continue
    if (inClause(sc, 'where', i) && ctx.owner[i] === sc.index) {
      out.push({ ...span(t, sig[q] || t), message: `${t.upper}() cannot be in WHERE: filter aggregates in HAVING (with GROUP BY), or aggregate in a subquery.` })
      continue
    }
    // Nested: another aggregate between the parens, in the same scope.
    for (let k = i + 2; q > 0 && k < q; k++) {
      const u = sig[k]
      if (u.type === 'word' && AGGREGATES.has(u.upper) && sig[k + 1]?.type === 'lparen' && ctx.owner[k] === ctx.owner[i]) {
        const uq = matchParen(sig, k + 1)
        if (uq > 0 && isWord(sig[uq + 1], 'OVER')) continue
        out.push({ ...span(t, sig[q]), message: `An aggregate inside another (${t.upper}(${u.upper}(...))) is refused: aggregate in a subquery first.` })
        break
      }
    }
  }
  return out
}

// QS055: IN (SELECT a, b ...).
function ruleInSubqueryColumns(ctx) {
  const out = []
  for (const sc of ctx.scopes) {
    if (sc.kind !== 'sub') continue
    const p = sc.idx - 1
    if (ctx.sig[p]?.type !== 'lparen' || !isWord(ctx.sig[p - 1], 'IN')) continue
    if (sc.items.length > 1 || sc.items.some((it) => it.star)) {
      out.push({ ...span(ctx.sig[sc.idx], ctx.sig[sc.idx]), message: 'The subquery after IN must return exactly one column.' })
    }
  }
  return out
}

// QS056: GROUP BY 1.
function ruleGroupByNumber(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const gb = sc.clauses.groupBy
    if (!gb) continue
    for (const g of splitOnCommas(sig, gb.body, gb.end, sc.depth)) {
      if (g.end === g.start && sig[g.start]?.type === 'number') out.push({ ...span(sig[g.start], sig[g.start]), message: `GROUP BY ${sig[g.start].value} groups by the number ${sig[g.start].value}, not a column: SQL Server has no GROUP BY position. Write the column.` })
    }
  }
  return out
}

// QS057: ORDER BY position out of range, or a constant.
function ruleOrderByInvalid(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ob = sc.clauses.orderBy
    if (!ob) continue
    for (const g of splitOnCommas(sig, ob.body, ob.end, sc.depth)) {
      if (g.end < g.start) continue
      const t = sig[g.start]
      const single = g.end === g.start || (g.end === g.start + 1 && isWord(sig[g.end], 'ASC', 'DESC'))
      if (!single) continue
      if (t.type === 'number' && !sc.items.some((it) => it.star) && (Number(t.value) < 1 || Number(t.value) > sc.items.length)) {
        out.push({ ...span(t, t), message: `ORDER BY ${t.value} is out of range: the select list has ${sc.items.length} column${sc.items.length === 1 ? '' : 's'}.` })
      } else if (t.type === 'string') {
        out.push({ ...span(t, t), message: 'ORDER BY a text constant is refused: order by a column.' })
      }
    }
  }
  return out
}

// QS058: SELECT DISTINCT ... ORDER BY something not selected.
function ruleDistinctOrderBy(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const ob = sc.clauses.orderBy
    if (!sc.distinct || !ob || sc.items.some((it) => it.star)) continue
    const names = new Set(sc.items.map((it) => (it.outName || '').toLowerCase()).filter(Boolean))
    const exprs = new Set(sc.items.map((it) => ctx.sql.slice(sig[it.exprStart].start, sig[it.exprEnd].end).replace(/\s+/g, '').toLowerCase()))
    for (const g of splitOnCommas(sig, ob.body, ob.end, sc.depth)) {
      if (g.end < g.start) continue
      let e = g.end
      if (isWord(sig[e], 'ASC', 'DESC')) e--
      if (e < g.start || sig[g.start].type === 'number') continue
      const text = ctx.sql.slice(sig[g.start].start, sig[e].end).replace(/\s+/g, '').toLowerCase()
      const ch = chainAt(sig, g.start)
      const last = ch && ch.end === e ? identName(ch.parts[ch.parts.length - 1]).toLowerCase() : null
      if (exprs.has(text) || (last && names.has(last))) continue
      out.push({ ...span(sig[g.start], sig[e]), message: 'With SELECT DISTINCT, ORDER BY items must be in the select list.' })
    }
  }
  return out
}

// QS059: a JSON literal that is not valid JSON.
function ruleJsonLiteral(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    if (!isWord(sig[i], 'JSON_VALUE', 'JSON_QUERY', 'ISJSON', 'JSON_MODIFY') || sig[i + 1]?.type !== 'lparen') continue
    const s = sig[i + 2]
    if (s?.type !== 'string' || !/^\s*[[{]/.test(stringValue(s))) continue
    try { JSON.parse(stringValue(s)) } catch {
      if (sig[i].upper !== 'ISJSON') out.push({ ...span(s, s), message: 'This JSON text is not valid JSON, so the run fails with "JSON text is not properly formatted".' })
    }
  }
  return out
}

// QS060: a -- comment at the end of the query.
function ruleTrailingLineComment(ctx) {
  const all = ctx.tokens.filter((t) => t.type !== 'ws')
  const last = all[all.length - 1]
  if (last?.type !== 'comment' || !last.line) return []
  const body = last.value.slice(2).trim().replace(/\*\//g, '* /')
  return [{
    ...span(last, last),
    message: 'A -- comment at the very end can swallow what SFMC adds after the query, so the activity saves but the run fails. Use /* */ or remove it.',
    fixes: [{ label: 'Use /* */', changes: [{ from: last.start, to: last.end, insert: `/* ${body} */` }] }],
  }]
}

// QS061: expressions that fail the whole run on one bad row.
function ruleRunTimeFailures(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'word' || sig[i - 1]?.type === 'dot' || sig[i + 1]?.type !== 'lparen') continue
    const q = matchParen(sig, i + 1)
    if (q < 0) continue
    if (t.upper === 'CONVERT' || t.upper === 'CAST') {
      const typeTok = t.upper === 'CONVERT' ? sig[i + 2] : (() => { for (let k = q - 1; k > i; k--) if (isWord(sig[k - 1], 'AS') && sig[k - 1].depth === sig[i + 1].depth + 1) return sig[k]; return null })()
      if (isWord(typeTok, 'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'INT', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'MONEY')) {
        out.push({ ...span(t, t), message: `${t.upper} to ${typeTok.upper} fails the whole run if one value cannot be converted. TRY_${t.upper} gives NULL for that row instead.`, fixes: [{ label: `Use TRY_${t.upper}`, changes: [{ from: t.start, to: t.end, insert: `TRY_${t.upper}` }] }] })
      }
    } else if (t.upper === 'DATEDIFF' && isWord(sig[i + 2], 'SECOND', 'SS', 'S', 'MILLISECOND', 'MS', 'MICROSECOND', 'NANOSECOND')) {
      out.push({ ...span(t, t), message: `DATEDIFF in ${sig[i + 2].upper} overflows INT over long spans (about 68 years of seconds, 24 days of milliseconds). DATEDIFF_BIG does not.`, fixes: [{ label: 'Use DATEDIFF_BIG', changes: [{ from: t.start, to: t.end, insert: 'DATEDIFF_BIG' }] }] })
    } else if (isWord(t, 'LEFT', 'RIGHT', 'SUBSTRING')) {
      for (let k = i + 2; k < q; k++) {
        if (isWord(sig[k], 'CHARINDEX', 'PATINDEX') && sig[k + 1]?.type === 'lparen') {
          const cq = matchParen(sig, k + 1)
          if (sig[cq + 1]?.type === 'op' && sig[cq + 1].value === '-') {
            out.push({ ...span(t, sig[q]), message: `${t.upper} with ${sig[k].upper}(...) - n fails the run on rows where the text is not found (the length becomes negative). Wrap it: NULLIF(${sig[k].upper}(...), 0) - n.` })
            break
          }
        }
      }
    }
  }
  // Division: flag `/ x` unless the divisor is a non-zero number or NULLIF(...).
  for (let i = 1; i < sig.length - 1; i++) {
    const t = sig[i]
    if (t.type !== 'op' || (t.value !== '/' && t.value !== '%')) continue
    const n = sig[i + 1]
    if (n.type === 'number' && Number(n.value) !== 0) continue
    if (isWord(n, 'NULLIF') || (n.type === 'lparen' && isWord(sig[i + 2], 'NULLIF'))) continue
    out.push({ ...span(t, t), message: 'A division fails the whole run when the divisor is 0 for any row: divide by NULLIF(divisor, 0).' })
  }
  return out
}

// QS062: "text" in a comparison is a column name in SQL Server.
function ruleDoubleQuotedValue(ctx) {
  const { sig } = ctx
  const out = []
  for (let i = 1; i < sig.length; i++) {
    const t = sig[i]
    if (t.type !== 'ident' || !t.quoted) continue
    const p = sig[i - 1]
    const valuePos = (p.type === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>='].includes(p.value)) || isWord(p, 'LIKE') ||
      ((p.type === 'lparen' || p.type === 'comma') && (() => { for (let k = i - 1; k >= 0; k--) { if (sig[k].type === 'lparen' && sig[k].depth === t.depth - 1) return isWord(sig[k - 1], 'IN'); } return false })())
    if (!valuePos) continue
    out.push({ ...span(t, t), message: `"${t.name}" is read as a column name (SFMC: Invalid column name). Text values take single quotes.`, fixes: [{ label: `Use '${t.name}'`, changes: [{ from: t.start, to: t.end, insert: `'${t.name.replace(/'/g, "''")}'` }] }] })
  }
  return out
}

// QS063: WHERE on the right table of a LEFT JOIN turns it into an INNER JOIN.
function ruleLeftJoinFilteredInWhere(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const w = sc.clauses.where
    if (!w) continue
    const refName = (t) => (t.alias ? identName(t.alias) : t.name)
    const lefts = sc.tables.filter((t, k) => k > 0 && !t.derived && (() => {
      // The words before this table's JOIN.
      for (let p = t.startIdx - 1; p >= 0 && p > t.startIdx - 4; p--) if (isWord(sig[p], 'LEFT')) return true
      return false
    })())
    if (!lefts.length) continue
    // Only plain AND-ed conditions at the WHERE's own level.
    let hasOr = false
    for (let i = w.body; i < w.end; i++) if (sig[i].depth === sc.depth && isWord(sig[i], 'OR')) hasOr = true
    if (hasOr) continue
    for (let i = w.body; i + 2 < w.end; i++) {
      if (sig[i].depth !== sc.depth || !isNameTok(sig[i]) || sig[i + 1]?.type !== 'dot') continue
      const t = lefts.find((l) => eqi(refName(l), identName(sig[i])))
      if (!t) continue
      // IS NULL keeps the LEFT JOIN meaning (rows without a match).
      if (isWord(sig[i + 3], 'IS') && isWord(sig[i + 4], 'NULL')) continue
      if (sig[i - 1]?.type === 'lparen' && isWord(sig[i - 2], 'ISNULL', 'COALESCE')) continue
      out.push({ ...span(sig[i], sig[i + 2]), message: `This WHERE condition on ${refName(t)} drops the rows the LEFT JOIN kept without a match, so it works like an INNER JOIN. Move it into the ON, or allow NULL.` })
      break
    }
  }
  return out
}

// QS064: _PushTag to _PushAddress on the device alone.
function rulePushJoin(ctx) {
  const { sig } = ctx
  const out = []
  for (const sc of ctx.scopes) {
    const names = sc.tables.map((t) => (t.derived ? '' : t.name.toUpperCase()))
    if (!names.includes('_PUSHTAG') || !names.includes('_PUSHADDRESS')) continue
    for (const t of sc.tables) {
      if (!t.on) continue
      const text = ctx.sql.slice(sig[t.on.start]?.start ?? 0, sig[t.on.end - 1]?.end ?? 0)
      if (/_?DeviceID/i.test(text) && !/_?APID/i.test(text)) {
        out.push({ ...span(sig[t.on.start], sig[t.on.end - 1]), message: 'A device ID is unique only within one MobilePush app: join _PushTag and _PushAddress on _DeviceID and _APID.' })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Registry

const RULES = [
  { code: 'QS001', severity: 'error', title: 'Only a single SELECT is allowed', check: ruleNotSelect },
  { code: 'QS002', severity: 'error', title: 'More than one statement', check: ruleMultipleStatements },
  { code: 'QS003', severity: 'error', title: 'Variables are not supported', check: ruleVariables },
  { code: 'QS004', severity: 'error', title: 'Temp tables and SELECT INTO are not supported', check: ruleTempTables },
  { code: 'QS005', severity: 'error', title: 'Stored procedures, user-defined functions and dbo. are not available', check: ruleProcedures },
  { code: 'QS006', severity: 'error', title: 'WITH (common table expressions) is not supported', check: ruleCte },
  { code: 'QS007', severity: 'error', title: 'SELECT * with a JOIN gives duplicate columns', check: ruleSelectStarJoin },
  { code: 'QS008', severity: 'error', title: 'Computed column without an alias', check: ruleNoAlias },
  { code: 'QS009', severity: 'error', title: 'Duplicate output column name', check: ruleDuplicateNames },
  { code: 'QS010', severity: 'error', title: 'Empty select list or stray comma', check: ruleEmptySelectItem },
  { code: 'QS011', severity: 'error', title: 'ORDER BY in a subquery without TOP or OFFSET', check: ruleOrderByInSubquery },
  { code: 'QS012', severity: 'info', title: 'TOP without ORDER BY', check: ruleTopWithoutOrder },
  { code: 'QS013', severity: 'error', title: 'Output column name is not a valid DE field name', check: ruleInvalidColumnName },
  { code: 'QS014', severity: 'error', title: 'Select alias used in WHERE, GROUP BY or HAVING (warning in HAVING)', check: ruleAliasInWhere },
  { code: 'QS015', severity: 'warning', title: 'Text column compared with a number column', check: ruleTextNumberCompare },
  { code: 'QS016', severity: 'error', title: 'Table name with spaces or hyphens needs brackets', check: ruleUnbracketedName },
  { code: 'QS017', severity: 'warning', title: 'Reserved word used as an alias', check: ruleReservedAlias },
  { code: 'QS018', severity: 'error', title: 'MID prefix on a table name', check: ruleMidPrefix },
  { code: 'QS019', severity: 'warning', title: '= NULL instead of IS NULL', check: ruleEqualsNull },
  { code: 'QS020', severity: 'warning', title: 'NOT IN with a subquery', check: ruleNotInSubquery },
  { code: 'QS021', severity: 'warning', title: 'LIKE pattern without a wildcard', check: ruleLikeNoWildcard },
  { code: 'QS022', severity: 'warning', title: 'String concatenation with +', check: rulePlusConcat },
  { code: 'QS023', severity: 'info', title: 'GETDATE() returns SFMC server time', check: ruleServerTime },
  { code: 'QS024', severity: 'warning', title: "AT TIME ZONE 'Central Standard Time' on server time", check: ruleCentralTimeZone },
  { code: 'QS025', severity: 'warning', title: 'DECIMAL without precision and scale', check: ruleDecimalPrecision },
  { code: 'QS026', severity: 'warning', title: 'Column not in GROUP BY or an aggregate', check: ruleNotGrouped },
  { code: 'QS027', severity: 'warning', title: 'Tracking data view without a date or JobID filter', check: ruleTrackingNoFilter },
  { code: 'QS028', severity: 'warning', title: 'Tracking data views joined without JobID', check: ruleTrackingJoinNoJobId },
  { code: 'QS029', severity: 'error', title: 'Target DE is also a source', check: ruleTargetAsSource },
  { code: 'QS030', severity: 'warning', title: 'UNION branches with different column counts', check: ruleUnionColumnCount },
  { code: 'QS031', severity: 'info', title: 'UNION where UNION ALL may do', check: ruleUnionAll },
  { code: 'QS032', severity: 'error', title: 'Unbalanced parentheses, brackets, quotes or comments', check: ruleUnbalanced },
  { code: 'QS033', severity: 'warning', title: 'Column not found in the table', check: ruleUnknownColumn },
  { code: 'QS034', severity: 'error', title: 'Unknown data extension', check: ruleUnknownTable },
  { code: 'QS035', severity: 'error', title: 'Function not available in SFMC', check: ruleForbiddenFunction },
  { code: 'QS036', severity: 'error', title: 'ENT. prefix in the parent BU', check: ruleEntInParent },
  { code: 'QS037', severity: 'error', title: 'FROM inside TRIM() or IS DISTINCT FROM', check: ruleFromInsideExpression },
  { code: 'QS038', severity: 'error', title: 'Table-valued function with more than one argument', check: ruleTvfArgs },
  { code: 'QS039', severity: 'error', title: "N'...' Unicode string literal", check: ruleUnicodeLiteral },
  { code: 'QS040', severity: 'error', title: 'Odd number of apostrophes in a comment', check: ruleCommentApostrophe },
  { code: 'QS041', severity: 'error', title: 'FOR JSON or FOR XML at the top level', check: ruleForJson },
  { code: 'QS042', severity: 'info', title: 'ORDER BY column number', check: ruleOrderByNumber },
  { code: 'QS043', severity: 'warning', title: 'SELECT * instead of a column list', check: ruleSelectStar },
  { code: 'QS044', severity: 'warning', title: 'Output column name starts with an underscore', check: ruleUnderscoreName },
  { code: 'QS045', severity: 'error', title: 'ORDER BY without TOP at the top level', check: ruleOrderByTopLevel },
  { code: 'QS046', severity: 'error', title: 'Tables separated by commas in FROM (old style join)', check: ruleCommaJoin },
  { code: 'QS047', severity: 'error', title: 'Syntax from another database (LIMIT, ||, CURRENT_DATE, ILIKE, ::, backticks)', check: ruleOtherDialect },
  { code: 'QS048', severity: 'error', title: 'Function from another database (NOW, IFNULL, NVL, SUBSTR, ...)', check: ruleOtherFunctions },
  { code: 'QS049', severity: 'error', title: 'Alias or table not in FROM (could not be bound)', check: ruleUnknownAlias },
  { code: 'QS050', severity: 'error', title: 'The same alias twice in one FROM', check: ruleDuplicateAlias },
  { code: 'QS051', severity: 'error', title: 'Window function in WHERE, GROUP BY or HAVING', check: ruleWindowPlacement },
  { code: 'QS052', severity: 'error', title: 'DISTINCT in a window function', check: ruleWindowDistinct },
  { code: 'QS053', severity: 'error', title: 'Window function shape (ORDER BY, frame, STRING_AGG, PERCENTILE)', check: ruleWindowShape },
  { code: 'QS054', severity: 'error', title: 'Aggregate in WHERE, or an aggregate inside another', check: ruleAggregatePlacement },
  { code: 'QS055', severity: 'error', title: 'Subquery after IN returns more than one column', check: ruleInSubqueryColumns },
  { code: 'QS056', severity: 'error', title: 'GROUP BY a column number', check: ruleGroupByNumber },
  { code: 'QS057', severity: 'error', title: 'ORDER BY position out of range, or a text constant', check: ruleOrderByInvalid },
  { code: 'QS058', severity: 'error', title: 'SELECT DISTINCT with ORDER BY on a column not selected', check: ruleDistinctOrderBy },
  { code: 'QS059', severity: 'error', title: 'JSON literal that is not valid JSON', check: ruleJsonLiteral },
  { code: 'QS060', severity: 'warning', title: '-- comment at the end of the query', check: ruleTrailingLineComment },
  { code: 'QS061', severity: 'info', title: 'Expression that fails the whole run on one bad row', check: ruleRunTimeFailures },
  { code: 'QS062', severity: 'error', title: 'Text value in double quotes', check: ruleDoubleQuotedValue },
  { code: 'QS063', severity: 'warning', title: 'WHERE on a LEFT JOIN table makes it an INNER JOIN', check: ruleLeftJoinFilteredInWhere },
  { code: 'QS064', severity: 'warning', title: '_PushTag and _PushAddress joined without _APID', check: rulePushJoin },
]

/** Every rule, for a settings or help list. */
export const LINT_RULES = RULES.map(({ code, severity, title }) => ({ code, severity, title }))

/** Rules that are off unless the caller passes its own `disabled` list. */
export const DEFAULT_DISABLED = ['QS034']

/**
 * Lints one SFMC query.
 *
 * @param {string} sql
 * @param {object} [options]
 * @param {Object<string,{name:string,fields:{name:string,type:number}[]}>} [options.tables]
 *   known DEs by lower-case name; `__complete: true` means the list is the whole BU
 * @param {string} [options.targetName]  target DE name
 * @param {boolean} [options.isParentBU]  running in the enterprise (parent) BU
 * @param {string[]} [options.disabled]  rule codes to skip; defaults to DEFAULT_DISABLED
 * @returns {{from:number,to:number,severity:string,code:string,message:string,fixes?:object[]}[]}
 */
export function lintSql(sql, options = {}) {
  const text = typeof sql === 'string' ? sql : ''
  if (!text.trim()) return []
  const opts = options || {}
  let ctx
  try { ctx = buildContext(text, opts) } catch { return [] }
  const disabled = new Set(Array.isArray(opts.disabled) ? opts.disabled : DEFAULT_DISABLED)
  const out = []
  for (const rule of RULES) {
    if (disabled.has(rule.code)) continue
    try {
      for (const d of rule.check(ctx) || []) {
        const diag = { from: d.from, to: d.to, severity: d.severity || rule.severity, code: rule.code, message: d.message }
        if (d.fixes?.length) diag.fixes = d.fixes
        out.push(diag)
      }
    } catch {
      // A broken rule must not take the others down.
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Applies a fix's changes (right to left, so offsets stay valid). */
export function applyFix(sql, fix) {
  const changes = [...(fix?.changes || [])].sort((a, b) => b.from - a.from || b.to - a.to)
  let out = sql
  for (const c of changes) out = out.slice(0, c.from) + (c.insert || '') + out.slice(c.to)
  return out
}

/** Fixes that change what the query returns, so Fix all leaves them to the user. */
export const FIX_ALL_SKIP = new Set(['QS027', 'QS061'])

/**
 * Applies every fix it can, one at a time (the query is linted again after each, so
 * offsets stay right), taking each problem's first fix. Stops when nothing is left to
 * fix or after `max` rounds. Returns { sql, applied: [{ code, label }] }.
 */
export function fixAll(sql, options = {}, max = 100) {
  let text = typeof sql === 'string' ? sql : ''
  const applied = []
  const tried = new Set()
  for (let round = 0; round < max; round++) {
    const d = lintSql(text, options).find((x) => x.fixes?.length && !FIX_ALL_SKIP.has(x.code) && !tried.has(`${x.code}@${x.from}:${text.length}`))
    if (!d) break
    const next = applyFix(text, d.fixes[0])
    tried.add(`${d.code}@${d.from}:${text.length}`)
    if (next === text) continue
    applied.push({ code: d.code, label: d.fixes[0].label })
    text = next
  }
  return { sql: text, applied }
}
