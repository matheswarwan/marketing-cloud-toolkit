<script setup>
import { shallowRef, onBeforeUnmount } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { sfmcSqlExtensions, formatCommand, fixAllCommand, relintOnCatalogChange } from '@/editor/sqlExtensions.js'
import { createSchemaCatalog } from '@/utils/schemaCatalog.js'
import { planInsertAllFields, fieldRef, tableRef } from '@/utils/insertFields.js'
import { bareTableName } from '@/utils/schemaCatalog.js'
import { referencedTables } from '@/utils/sqlContext.js'
import { planJoin } from '@/utils/joinInsert.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // SFMC stack (s7, s10, ...). Without it, autocomplete only knows the data views.
  stack:      { type: String, default: null },
  // @run: Cmd/Ctrl+Enter, called with the selected SQL or null (feedback #75).
  // Without a listener the key keeps CodeMirror's own meaning.
  onRun:      { type: Function, default: null },
  // @schema-search: Cmd/Ctrl+Shift+S, opens the schema search beside the editor (feedback #72).
  onSchemaSearch: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'format'])

const catalog = createSchemaCatalog(() => props.stack)
const extensions = [
  ...sfmcSqlExtensions(catalog, { onFormat: (r) => emit('format', r) }),
  oneDark,
  Prec.highest(keymap.of([{
    key: 'Mod-Enter',
    run: (v) => {
      if (!props.onRun) return false
      const sel = v.state.selection.main
      const text = sel.empty ? '' : v.state.sliceDoc(sel.from, sel.to)
      props.onRun(text.trim() ? text : null)
      return true
    },
  }, {
    key: 'Mod-Shift-s',
    run: () => {
      if (!props.onSchemaSearch) return false
      props.onSchemaSearch()
      return true
    },
  }])),
]

const view = shallowRef(null)
let unsubscribe = null

function onReady({ view: v }) {
  view.value = v
  unsubscribe = relintOnCatalogChange(v, catalog)
}

onBeforeUnmount(() => unsubscribe?.())

/** Formats the editor's SQL. Returns { ok, sql, error? }. */
function format() {
  if (!view.value) return { ok: false, error: 'Editor not ready' }
  const r = formatCommand(view.value)
  emit('format', r)
  return r
}

/**
 * Inserts every field of a DE or data view (see insertFields.js for where it goes).
 * Returns { ok, count?, mode?, error? }.
 */
async function insertAllFields(tableName) {
  const v = view.value
  if (!v) return { ok: false, error: 'Editor not ready' }
  const fields = await catalog.fieldsFor(tableName)
  if (!fields?.length) return { ok: false, error: `No fields found for ${tableName}.` }
  const sql = v.state.doc.toString()
  const plan = planInsertAllFields(sql, v.state.selection.main.head, tableName, fields)
  if (!plan) return { ok: false, error: `No fields found for ${tableName}.` }
  v.dispatch({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    selection: { anchor: plan.from + plan.insert.length },
  })
  v.focus()
  return { ok: true, count: fields.length, mode: plan.mode }
}

/** Tables named in FROM/JOIN of the current SQL. */
function tablesInQuery() {
  const seen = new Set()
  return referencedTables(view.value?.state.doc.toString() || props.modelValue || '')
    .map(r => r.name)
    .filter(n => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
}

/** The selected text, or '' when nothing is selected. */
function selectedText() {
  const v = view.value
  if (!v) return ''
  const sel = v.state.selection.main
  return sel.empty ? '' : v.state.sliceDoc(sel.from, sel.to)
}

/** Replaces the selection (or inserts at the cursor) with `text`. */
function insertText(text) {
  const v = view.value
  if (!v || !text) return false
  const sel = v.state.selection.main
  v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
  v.focus()
  return true
}

/**
 * How a field of `tableName` is written in this query: `alias.Field` when the query
 * names the table with an alias, `Table.Field` when it has several tables, else `Field`.
 */
function fieldFor(tableName, field) {
  const target = bareTableName(tableName).toLowerCase()
  const refs = referencedTables(view.value?.state.doc.toString() || props.modelValue || '')
  const ref = refs.find(r => bareTableName(r.name).toLowerCase() === target)
  const qualifier = ref?.alias ? fieldRef(ref.alias) : (ref && refs.length > 1 ? tableRef(ref.name) : null)
  return fieldRef(field, qualifier)
}

/** Data views and DEs whose name contains `prefix` (DE search from 2 characters). */
function searchTables(prefix) {
  return catalog.searchTables(prefix)
}

/** Adds a JOIN for `table` ({ name }) with its `fields` to the SQL. Returns planJoin's result. */
async function joinTable(table, fields) {
  const v = view.value
  if (!v) return { error: 'Editor not ready' }
  const plan = await planJoin(v.state.doc.toString(), table, fields, (name) => catalog.fieldsFor(name))
  if (plan.error) return plan
  v.dispatch({ changes: { from: plan.at, to: plan.at, insert: plan.insert } })
  v.focus()
  return plan
}

/** Applies every one-click lint fix. Returns { applied: [{ code, label }] }. */
function fixAll() {
  if (!view.value) return { applied: [] }
  return fixAllCommand(view.value, catalog)
}

defineExpose({ joinTable, fixAll, format, insertAllFields, tablesInQuery, searchTables, selectedText, insertText, fieldFor })
</script>

<template>
  <Codemirror
    :modelValue="modelValue"
    :extensions="extensions"
    :style="{ height: '100%', fontSize: '13px', fontFamily: 'JetBrains Mono, Fira Code, Courier New, monospace' }"
    @ready="onReady"
    @change="(val) => emit('update:modelValue', val)"
  />
</template>
