<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Search, Loader2, KeyRound, X, ArrowLeft, ListPlus, GitMerge } from 'lucide-vue-next'
import { DATA_VIEW_FIELDS } from '@/utils/dataViews.js'
import { fetchDEFieldList, fieldTypeLabel } from '@/utils/deApi.js'

// Schema search beside the Run Query editor, like Query Studio's (feedback #72):
// type part of a DE or data view name, pick one, and see its fields. A click on a
// field writes it at the cursor (with the query's alias for that table, if any).
const props = defineProps({
  // The QueryEditor component instance (searchTables, insertText, fieldFor, insertAllFields).
  editor: { type: Object, default: null },
  stack:  { type: String, default: null },
})
const emit = defineEmits(['close'])

const DV_TYPES = ['Text', 'Number', 'Date', 'Boolean', 'EmailAddress', 'Phone', 'Decimal']

const query = ref('')
const results = ref([])
const searching = ref(false)
const picked = ref(null)      // { name, kind, sourceType, id }
const fields = ref([])        // [{ name, type, isPrimaryKey }]
const loadingFields = ref(false)
const fieldError = ref('')
const fieldFilter = ref('')
const note = ref('')
const searchInput = ref(null)
let timer = null
let seq = 0
let fieldSeq = 0

watch(query, (q) => {
  clearTimeout(timer)
  const text = q.trim()
  if (!text) { results.value = []; searching.value = false; return }
  searching.value = true
  const mine = ++seq
  timer = setTimeout(async () => {
    let items = []
    try { items = (await props.editor?.searchTables?.(text)) || [] } catch { items = [] }
    if (mine !== seq) return
    results.value = items.slice(0, 50)
    searching.value = false
  }, 250)
})

/** How the table is written in SQL: data views bare, Shared DEs with ENT. */
function sqlTableName(t) {
  return t.sourceType === 'shared' ? `ENT.${t.name}` : t.name
}

function kindLabel(t) {
  if (t.kind === 'dataview') return 'data view'
  if (t.sourceType === 'shared') return 'Shared'
  if (t.sourceType === 'sync') return 'Synchronized'
  return 'DE'
}

async function pick(t) {
  picked.value = t
  fields.value = []
  fieldError.value = ''
  fieldFilter.value = ''
  note.value = ''
  const mine = ++fieldSeq
  if (t.kind === 'dataview') {
    fields.value = (DATA_VIEW_FIELDS[t.name.toUpperCase()] || []).map((f) => ({ name: f.name, label: DV_TYPES[f.type] || '' }))
    return
  }
  if (!props.stack || !t.id) { fieldError.value = 'Fields are not available for this data extension.'; return }
  loadingFields.value = true
  try {
    const list = await fetchDEFieldList(props.stack, t.id)
    if (mine !== fieldSeq) return
    fields.value = list.map((f) => ({ name: f.name, label: fieldTypeLabel(f), isPrimaryKey: !!f.isPrimaryKey, required: f.isNullable === false }))
  } catch (e) {
    if (mine !== fieldSeq) return
    fieldError.value = `Could not read the fields: ${e.message}`
  } finally {
    if (mine === fieldSeq) loadingFields.value = false
  }
}

function back() {
  picked.value = null
  fieldSeq++
  loadingFields.value = false
  nextTick(() => searchInput.value?.focus())
}

const shownFields = computed(() => {
  const f = fieldFilter.value.trim().toLowerCase()
  return f ? fields.value.filter((x) => x.name.toLowerCase().includes(f)) : fields.value
})

function insertField(f) {
  if (!props.editor || !picked.value) return
  props.editor.insertText(props.editor.fieldFor(sqlTableName(picked.value), f.name))
}

function insertName() {
  if (!props.editor || !picked.value) return
  const t = picked.value
  const name = t.kind === 'dataview' ? t.name : t.sourceType === 'shared' ? `ENT.[${t.name}]` : `[${t.name}]`
  props.editor.insertText(name)
}

// Join to the query: a LEFT JOIN with the ON condition from the data view rules or a shared key.
async function joinToQuery() {
  if (!props.editor?.joinTable || !picked.value) return
  const r = await props.editor.joinTable({ name: sqlTableName(picked.value) }, fields.value)
  note.value = r.error || (r.matched ? `Joined as ${r.alias}.` : `Joined as ${r.alias}; set its ON condition.`)
}

async function insertAll() {
  if (!props.editor || !picked.value) return
  note.value = ''
  const r = await props.editor.insertAllFields(sqlTableName(picked.value))
  if (!r?.ok) note.value = r?.error || 'Could not insert the fields.'
}

function focus() {
  nextTick(() => searchInput.value?.focus())
}

defineExpose({ focus })
</script>

<template>
  <div class="flex flex-col h-full min-h-0 border-l border-border bg-card text-[11px]">
    <div class="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
      <span class="font-semibold flex-1">Schema</span>
      <button class="p-0.5 rounded hover:bg-muted text-muted-foreground" title="Close schema search" aria-label="Close schema search" @click="emit('close')"><X class="h-3 w-3" /></button>
    </div>

    <template v-if="!picked">
      <div class="p-2 shrink-0">
        <div class="relative">
          <Search class="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            ref="searchInput"
            v-model="query"
            class="w-full rounded border border-border bg-background text-foreground pl-6 pr-1.5 py-1"
            placeholder="Data extension or data view name"
            aria-label="Search data extensions and data views"
          />
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-auto px-1 pb-2">
        <div v-if="searching" class="px-1.5 py-1 text-muted-foreground flex items-center gap-1"><Loader2 class="h-3 w-3 animate-spin" /> Searching</div>
        <ul v-else-if="results.length">
          <li v-for="t in results" :key="t.kind + (t.sourceType || '') + t.name + (t.id || '')">
            <button class="w-full text-left px-1.5 py-1 rounded hover:bg-muted flex items-center gap-1" @click="pick(t)">
              <span class="truncate flex-1" :title="t.name">{{ t.name }}</span>
              <span class="shrink-0 text-[10px] text-muted-foreground">{{ kindLabel(t) }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="query.trim()" class="px-1.5 py-1 text-muted-foreground">No match. Data extensions are searched from 2 characters.</p>
        <p v-else class="px-1.5 py-1 text-muted-foreground">Search this business unit's data extensions, Shared and Synchronized ones, and data views. Pick one to see its fields.</p>
      </div>
    </template>

    <template v-else>
      <div class="px-2 pt-2 shrink-0">
        <button class="flex items-center gap-1 text-primary hover:underline mb-1" @click="back"><ArrowLeft class="h-3 w-3" /> Back to search</button>
        <div class="font-semibold break-all">{{ picked.name }} <span class="font-normal text-[10px] text-muted-foreground">{{ kindLabel(picked) }}</span></div>
        <div class="flex flex-wrap gap-1 my-1.5">
          <button class="rounded border border-border px-1.5 py-0.5 hover:border-primary hover:text-primary" title="Write the table name at the cursor" @click="insertName">Insert name</button>
          <button class="rounded border border-border px-1.5 py-0.5 hover:border-primary hover:text-primary flex items-center gap-1" title="Write every field (see Insert all fields)" @click="insertAll"><ListPlus class="h-3 w-3" /> All fields</button>
          <button class="rounded border border-border px-1.5 py-0.5 hover:border-primary hover:text-primary flex items-center gap-1" :disabled="loadingFields" title="Add a LEFT JOIN for this table to the query, with the ON condition from the data view rules or a shared key field" @click="joinToQuery"><GitMerge class="h-3 w-3" /> Join</button>
        </div>
        <p v-if="note" class="text-red-600 mb-1">{{ note }}</p>
        <input
          v-if="fields.length > 8"
          v-model="fieldFilter"
          class="w-full rounded border border-border bg-background text-foreground px-1.5 py-1 mb-1"
          placeholder="Filter fields"
          aria-label="Filter fields"
        />
      </div>
      <div class="flex-1 min-h-0 overflow-auto px-1 pb-2">
        <div v-if="loadingFields" class="px-1.5 py-1 text-muted-foreground flex items-center gap-1"><Loader2 class="h-3 w-3 animate-spin" /> Reading fields</div>
        <p v-else-if="fieldError" class="px-1.5 py-1 text-red-600">{{ fieldError }}</p>
        <ul v-else-if="shownFields.length">
          <li v-for="f in shownFields" :key="f.name">
            <button class="w-full text-left px-1.5 py-1 rounded hover:bg-muted flex items-center gap-1" title="Insert at the cursor" @click="insertField(f)">
              <KeyRound v-if="f.isPrimaryKey" class="h-3 w-3 shrink-0 text-amber-600" aria-label="Primary key" />
              <span class="truncate flex-1" :class="{ 'font-semibold': f.isPrimaryKey }">{{ f.name }}</span>
              <span class="shrink-0 text-[10px] text-muted-foreground">{{ f.label }}{{ f.required ? ', required' : '' }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="px-1.5 py-1 text-muted-foreground">No fields.</p>
      </div>
    </template>
  </div>
</template>
