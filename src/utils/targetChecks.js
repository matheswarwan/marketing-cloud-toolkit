// Checks before Save as query activity: what SFMC will do with this query's rows in
// the chosen target data extension, so problems show before the first run fails (or,
// worse, succeeds and quietly loses data). The rules are SFMC's documented behaviour.
import { tokenize, significant, isWord } from './sqlTokens.js'
import { referencedTables } from './sqlContext.js'
import { bareTableName } from './schemaCatalog.js'

const TYPE_NAMES = { 0: 'text', 1: 'number', 2: 'date', 3: 'boolean', 4: 'emailaddress', 5: 'phone', 6: 'decimal', 7: 'locale' }
const typeOf = (f) => {
  const t = f?.type ?? f?.fieldType
  return (typeof t === 'number' ? TYPE_NAMES[t] : String(t || 'text')).toLowerCase().replace(/\s+/g, '')
}
const lc = (s) => String(s || '').toLowerCase()
const TEXTISH = new Set(['text', 'emailaddress', 'phone', 'locale'])
const isKey = (f) => !!(f?.isPrimaryKey || f?.primaryKey)
const isRequired = (f) => isKey(f) || f?.isNullable === false || f?.isRequired === true

/**
 * @param {object} p
 * @param {string} p.sql  the query
 * @param {Array} p.outFields  the query's output columns as fields ({ name, type, length, isPrimaryKey })
 * @param {Array} p.targetFields  the target DE's fields (same shape, from SFMC)
 * @param {number} p.updateType  0 Overwrite, 1 Update, 2 Append
 * @param {string} [p.targetName]
 * @param {boolean} [p.newTarget]  the target is created from the query's columns
 * @returns {Array<{ level: 'error'|'warning'|'info', text: string }>}
 */
export function checkTarget({ sql, outFields = [], targetFields = [], updateType = 0, targetName = '', newTarget = false }) {
  const out = []
  const add = (level, text) => out.push({ level, text })
  const outBy = new Map(outFields.map((f) => [lc(f.name), f]))
  const targetBy = new Map(targetFields.map((f) => [lc(f.name), f]))
  const keys = targetFields.filter(isKey)
  const toks = significant(tokenize(sql || ''))

  if (!newTarget) {
    // Columns with nowhere to go are dropped without an error.
    const extra = outFields.filter((f) => !targetBy.has(lc(f.name)))
    if (extra.length) add('warning', `${extra.map((f) => f.name).join(', ')}: no field with ${extra.length === 1 ? 'that name' : 'these names'} in the target, so SFMC drops ${extra.length === 1 ? 'it' : 'them'} without an error.`)
    // Required fields the query leaves out fail every row (unless they have a default).
    const missing = targetFields.filter((f) => isRequired(f) && !outBy.has(lc(f.name)) && (f.defaultValue === undefined || f.defaultValue === null || f.defaultValue === ''))
    if (missing.length) add('error', `${missing.map((f) => f.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required in the target but not in the query: the run fails.`)
    // Types and lengths
    for (const o of outFields) {
      const t = targetBy.get(lc(o.name))
      if (!t) continue
      const ot = typeOf(o)
      const tt = typeOf(t)
      if (TEXTISH.has(ot) && ['number', 'decimal', 'date', 'boolean'].includes(tt)) {
        add('warning', `${o.name} is text in the query but ${t.type} in the target: any value that is not a valid ${tt} fails the run. Convert it with TRY_CONVERT.`)
      }
      if (ot === 'decimal' && tt === 'number') add('info', `${o.name}: the target is a whole Number, so decimals are cut off.`)
      const ol = Number(o.length) || 0
      const tl = Number(t.length) || 0
      // 4000 is the Run Query default for text of unknown length: not a real length.
      if (TEXTISH.has(tt) && tl && ol > tl && ol !== 4000) add('warning', `${o.name} can be ${ol} characters but the target field holds ${tl}: longer values fail the run.`)
      if (tt === 'emailaddress' && ot !== 'emailaddress') add('info', `${o.name} goes into an EmailAddress field, which also accepts text that is not an email address.`)
    }
  }

  // STRING_AGG into a short Text field
  if (/\bSTRING_AGG\s*\(/i.test(sql || '')) add('info', 'STRING_AGG output can be long: make the target field 4000 characters and aggregate CAST(x AS NVARCHAR(MAX)) if it can pass 4,000.')

  // Data action
  const targetKeys = newTarget ? outFields.filter(isKey) : keys
  if (Number(updateType) === 1) {
    if (!targetKeys.length) add('error', 'Update needs a primary key in the target data extension; it has none, so the activity cannot update rows.')
    else if (outFields.length && outFields.every((f) => targetKeys.some((k) => lc(k.name) === lc(f.name)))) add('info', 'Every column is a key field, so Update only adds new keys: there is nothing to update.')
  }
  const reads = referencedTables(sql || '').some((r) => targetName && lc(bareTableName(r.name)) === lc(bareTableName(targetName)))
  if (reads && !newTarget) {
    if (Number(updateType) === 0) add('warning', 'The query reads its own target with Overwrite: SFMC empties the target first, so the query reads an empty table.')
    if (Number(updateType) === 2) add('warning', 'The query reads its own target with Append: rows it finds are added again.')
  }
  if (Number(updateType) === 0 && !newTarget) add('info', 'Overwrite empties the target first: a run that returns no rows leaves it empty.')

  // Keys the query can return twice
  if (targetKeys.length) {
    const deduped = toks.some((t) => t.depth === 0 && isWord(t, 'DISTINCT', 'GROUP')) || /\bROW_NUMBER\s*\(/i.test(sql || '')
    const outKeys = targetKeys.filter((k) => outBy.has(lc(k.name)))
    const joins = toks.filter((t) => isWord(t, 'JOIN')).length
    if (outKeys.length && !deduped && joins) {
      add('warning', `The query joins tables and does not make ${outKeys.map((k) => k.name).join(' + ')} unique (no DISTINCT, GROUP BY or ROW_NUMBER): a key that comes back twice fails Append${Number(updateType) === 2 ? '' : ', and Overwrite and Update keep one of the rows at random'}.`)
    }
  }
  return out
}
