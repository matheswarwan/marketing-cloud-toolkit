import { sql, MSSQL } from '@codemirror/lang-sql'
import { snippetCompletion } from '@codemirror/autocomplete'
import { linter, lintGutter } from '@codemirror/lint'
import { hoverTooltip, keymap, showTooltip, EditorView } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'

import { lintSql, fixAll } from '../utils/sqlLint.js'
import { disabledRules, setRuleDisabled, onLintSettingsChange } from './lintSettings.js'
import { columnList, fieldRef } from '../utils/insertFields.js'
import { SQL_FUNCTIONS, signatureAt, hoverDocAt } from '../utils/sqlDocs.js'
import { FIELD_VALUES } from '../utils/dataViews.js'
import { completionContext, referencedTables } from '../utils/sqlContext.js'
import { bareTableName } from '../utils/schemaCatalog.js'
import { formatDEForSql } from '../utils/deCatalog.js'
import { formatSql } from '../utils/sqlFormat.js'

// CodeMirror extensions for the SFMC SQL editor: autocomplete (data views, DEs
// from the live DE search, their fields, functions), lint diagnostics with
// one-click fixes, hover docs and signature help, and Shift+Alt+F to format.

const TYPE_NAMES = ['Text', 'Number', 'Date', 'Boolean', 'Email', 'Phone', 'Decimal', 'Locale']

// Plain SELECT * (QS043) is supported by the run flow, so the editor doesn't warn
// about it. The unknown-table rule (QS034) is on: it only flags tables the DE lookup
// confirmed missing. Rules the user turned off come from lintSettings.js.
const EDITOR_DISABLED = ['QS043']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function needsBrackets(name) {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

function fieldLabel(name) {
  return needsBrackets(name) ? `[${name.replace(/]/g, ']]')}]` : name
}

const FUNCTION_OPTIONS = Object.values(SQL_FUNCTIONS).map(f => {
  const noArgs = /\(\s*\)$/.test(f.signature || '')
  return snippetCompletion(noArgs ? `${f.name}()` : `${f.name}(\${})`, {
    label: f.name, type: 'function', detail: f.returns || '', info: f.signature, boost: -1,
  })
})

// Fields for every table in the query, keyed by alias (or the table's own name).
async function tablesInScope(doc, catalog) {
  const refs = referencedTables(doc)
  const scoped = []
  await Promise.all(refs.map(async (r) => {
    const fields = await catalog.fieldsFor(r.name)
    scoped.push({ ...r, fields })
  }))
  return scoped
}

function findQualified(scoped, qualifier) {
  const q = qualifier.toLowerCase()
  return scoped.find(t => t.alias?.toLowerCase() === q)
    ?? scoped.find(t => bareTableName(t.name).toLowerCase() === q)
}

function makeCompletionSource(catalog) {
  return async (context) => {
    const doc = context.state.doc.toString()
    const c = completionContext(doc, context.pos)
    if (c.kind === 'none') return null
    if (!context.explicit && c.kind !== 'member' && c.prefix.length === 0) return null

    if (c.kind === 'table') {
      // Wait for a pause in typing before calling the DE search API.
      await sleep(250)
      if (context.aborted) return null
      const items = await catalog.searchTables(c.prefix)
      if (context.aborted) return null
      return {
        from: c.from,
        filter: false,
        options: items.map(t => ({
          label: t.kind === 'dataview' ? t.name : formatDEForSql(t.name, t.sourceType || 'search'),
          displayLabel: t.name,
          type: t.kind === 'dataview' ? 'class' : 'type',
          detail: t.kind === 'dataview' ? 'data view' : 'data extension',
        })).filter((o, i, all) => all.findIndex(x => x.label.toLowerCase() === o.label.toLowerCase()) === i),
      }
    }

    const scoped = await tablesInScope(doc, catalog)
    if (context.aborted) return null

    if (c.kind === 'member') {
      const t = findQualified(scoped, c.qualifier)
      if (!t?.fields?.length) return null
      // `s.` + "* (all fields)": the first field completes `s.`, the rest are qualified.
      const allFields = t.fields.length > 1 ? [{
        label: '*',
        displayLabel: '* (all fields)',
        detail: `${t.fields.length} fields`,
        type: 'keyword',
        boost: 2,
        apply: [fieldRef(t.fields[0].name), ...t.fields.slice(1).map(f => fieldRef(f.name, fieldRef(c.qualifier)))].join(',\n    '),
      }] : []
      return {
        from: c.from,
        options: [...allFields, ...t.fields.map(f => ({ label: fieldLabel(f.name), type: 'property', detail: TYPE_NAMES[f.type] || '' }))],
        validFor: /^[\w\[\] ]*$/,
      }
    }

    if (c.kind === 'value') {
      const t = c.field.qualifier ? findQualified(scoped, c.field.qualifier) : scoped.find(s => s.fields?.some(f => f.name.toLowerCase() === c.field.name.toLowerCase()))
      const view = t ? bareTableName(t.name).toUpperCase() : null
      const values = (view && FIELD_VALUES?.[`${view}.${c.field.name.toUpperCase()}`]) || null
      if (!values) return null
      return { from: c.from, options: values.map(v => ({ label: typeof v === 'string' ? v : v.value, type: 'constant' })) }
    }

    // Columns: fields of every table in scope (alias-qualified when there is more
    // than one table), then functions. Keywords come from the SQL language itself.
    const multi = scoped.length > 1
    const options = []
    for (const t of scoped) {
      const q = t.alias || bareTableName(t.name)
      for (const f of t.fields || []) {
        options.push({
          label: multi ? `${needsBrackets(q) ? `[${q}]` : q}.${fieldLabel(f.name)}` : fieldLabel(f.name),
          type: 'property',
          detail: `${TYPE_NAMES[f.type] || ''} · ${bareTableName(t.name)}`,
          boost: 1,
        })
      }
    }
    // "All fields of X": the full column list in one go.
    for (const t of scoped) {
      if (!t.fields?.length) continue
      const name = bareTableName(t.name)
      const q = multi || t.alias ? fieldRef(t.alias || name) : null
      options.push({
        label: `All fields of ${t.alias ? `${name} (${t.alias})` : name}`,
        type: 'keyword',
        detail: `${t.fields.length} fields`,
        apply: columnList(t.fields, q),
        boost: -2,
      })
    }
    options.push(...FUNCTION_OPTIONS)
    return { from: c.from, options, validFor: /^[\w.\[\]]*$/ }
  }
}

// Dispatched to re-run lint without an edit (new catalog data, a rule turned off or
// on). forceLinting() can't do this: it only hurries a lint that is already pending.
const relintEffect = StateEffect.define()

function makeLinter(catalog, getOptions) {
  return linter((view) => {
    const doc = view.state.doc.toString()
    // Fetch fields for the tables in the query in the background; re-lint when they arrive.
    for (const r of referencedTables(doc)) catalog.fieldsFor(r.name)
    let diags = []
    try {
      diags = lintSql(doc, { tables: catalog.knownTables(), disabled: [...EDITOR_DISABLED, ...disabledRules()], ...(getOptions?.() || {}) })
    } catch {
      return []
    }
    return diags.map(d => ({
      from: Math.max(0, Math.min(d.from, doc.length)),
      to: Math.max(0, Math.min(d.to, doc.length)),
      severity: d.severity,
      source: d.code,
      message: d.message,
      actions: [
        ...(d.fixes || []).map(f => ({
          name: f.label,
          apply(v) { v.dispatch({ changes: f.changes }) },
        })),
        // Turned back on from Settings (Lint rules) in the Query Workspace.
        { name: `Turn off ${d.code}`, apply() { setRuleDisabled(d.code, true) } },
      ],
    }))
  }, {
    delay: 400,
    needsRefresh: (update) => update.transactions.some(tr => tr.effects.some(e => e.is(relintEffect))),
  })
}

function docHtml(doc) {
  const el = document.createElement('div')
  el.className = 'cm-sql-doc'
  const add = (tag, text, cls) => {
    if (!text) return
    const n = document.createElement(tag)
    n.textContent = text
    if (cls) n.className = cls
    el.appendChild(n)
  }
  add('div', doc.signature || doc.name, 'cm-sql-doc-sig')
  add('div', doc.description)
  if (doc.sfmc) add('div', `SFMC: ${doc.sfmc}`, 'cm-sql-doc-sfmc')
  if (doc.notes) add('div', doc.notes, 'cm-sql-doc-sfmc')
  if (doc.example) add('code', doc.example, 'cm-sql-doc-example')
  return el
}

function makeHover(catalog) {
  return hoverTooltip(async (view, pos) => {
    const doc = view.state.doc.toString()
    const h = hoverDocAt(doc, pos)
    if (h) {
      // Functions carry a doc object; data views and data view fields a sentence.
      const doc = typeof h.doc === 'string'
        ? { signature: h.kind === 'field' ? `${h.field?.name}: ${h.field?.typeName || ''}` : h.name, description: h.doc, notes: h.info?.notes }
        : h.doc
      return { pos: h.from, end: h.to, above: true, create: () => ({ dom: docHtml(doc) }) }
    }
    // alias.Field: show the field's type and table.
    const c = completionContext(doc, Math.min(doc.length, pos + 1))
    if (c.kind !== 'member') return null
    const word = view.state.wordAt(pos)
    if (!word) return null
    const name = doc.slice(word.from, word.to)
    const scoped = await tablesInScope(doc, catalog)
    const t = findQualified(scoped, c.qualifier)
    const f = t?.fields?.find(x => x.name.toLowerCase() === name.toLowerCase())
    if (!f) return null
    return {
      pos: word.from, end: word.to, above: true,
      create: () => ({ dom: docHtml({ signature: `${f.name}: ${TYPE_NAMES[f.type] || 'Text'}`, description: bareTableName(t.name) }) }),
    }
  }, { hoverTime: 350 })
}

// Signature help: while the cursor is inside a function's parentheses, show its signature.
const signatureField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value
    const pos = tr.state.selection.main.head
    const sig = signatureAt(tr.state.doc.toString(), pos)
    if (!sig?.doc) return null
    return {
      pos, above: true, strictSide: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-sql-doc cm-sql-doc-sig'
        dom.textContent = sig.doc.signature
        return { dom }
      },
    }
  },
  provide: f => showTooltip.from(f),
})

/** Fix all: every one-click fix in one go (one undo step). Returns { applied }. */
export function fixAllCommand(view, catalog) {
  const doc = view.state.doc.toString()
  const r = fixAll(doc, { tables: catalog.knownTables(), disabled: [...EDITOR_DISABLED, ...disabledRules()] })
  if (r.applied.length && r.sql !== doc) view.dispatch({ changes: { from: 0, to: doc.length, insert: r.sql } })
  return r
}

export function formatCommand(view) {
  const r = formatSql(view.state.doc.toString())
  if (r.ok && r.sql !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.sql } })
  }
  return r
}

const theme = EditorView.baseTheme({
  '.cm-sql-doc': { maxWidth: '420px', padding: '6px 8px', fontSize: '12px', lineHeight: '1.45' },
  '.cm-sql-doc > div + div': { marginTop: '4px' },
  '.cm-sql-doc-sig': { fontFamily: 'JetBrains Mono, Fira Code, monospace', fontWeight: '600' },
  '.cm-sql-doc-sfmc': { opacity: '0.85', fontStyle: 'italic' },
  '.cm-sql-doc-example': { display: 'block', marginTop: '4px', fontFamily: 'JetBrains Mono, Fira Code, monospace', whiteSpace: 'pre-wrap' },
})

/**
 * @param {ReturnType<import('../utils/schemaCatalog.js').createSchemaCatalog>} catalog
 * @param {{ getLintOptions?: () => object, onFormat?: (result) => void }} opts
 */
export function sfmcSqlExtensions(catalog, opts = {}) {
  const lang = sql({ dialect: MSSQL, upperCaseKeywords: true })
  return [
    lang,
    lang.language.data.of({ autocomplete: makeCompletionSource(catalog) }),
    makeLinter(catalog, opts.getLintOptions),
    lintGutter(),
    makeHover(catalog),
    signatureField,
    theme,
    keymap.of([{
      key: 'Shift-Alt-f',
      run: (view) => { opts.onFormat?.(formatCommand(view)); return true },
    }]),
  ]
}

/** Re-runs lint when the catalog learns new fields or the user turns a rule off or on. Returns an unsubscribe function. */
export function relintOnCatalogChange(view, catalog) {
  const relint = () => { try { view.dispatch({ effects: relintEffect.of(null) }) } catch {} }
  const offCatalog = catalog.onChange(relint)
  const offSettings = onLintSettingsChange(relint)
  return () => { offCatalog(); offSettings() }
}

