<script setup>
import { ref, computed, watch } from 'vue'
import { X, Loader2, Plus, ChevronDown, ChevronRight, Lock, GripVertical, ArrowUp, ArrowDown } from 'lucide-vue-next'
import Button from '../ui/button/Button.vue'
import WhereBuilder from './WhereBuilder.vue'
import QueryOptions from './QueryOptions.vue'
import OutputColumns from './OutputColumns.vue'
import { fetchDEFieldsCached } from '../../utils/sfmcApi.js'
import { DATA_VIEW_FIELDS, DATA_VIEWS } from '../../utils/dataViews.js'
import { suggestJoinConditions, aliasFor, aliasOf } from '../../utils/sqlBuilder.js'
import { defaultQueryOptions } from '../../utils/builderStorage.js'
import { moveDE, swapDEs, joinsForOrder, smartAlias } from '../../utils/builderOrder.js'

const props = defineProps({
  stack: { type: String, default: null },
  selected: { type: Array, default: () => [] },
  where: { type: Object, default: () => ({ combinator: 'AND', conditions: [] }) },
  queryOptions: { type: Object, default: () => defaultQueryOptions() },
  // The joins, when the parent changes them (the visual canvas shares this model).
  joins: { type: Array, default: null },
})

const emit = defineEmits([
  'update:selected', 'update:joins', 'update:where', 'update:queryOptions',
])

const JOIN_OPERATORS = ['=', '<>', '>', '<', '>=', '<=']

const loadingIds = ref(new Set())
const joins = ref([])
const openFieldDEs = ref(new Set())
const sectionOpen = ref({ structure: true, fields: false, filters: false, options: false })

const selectedList = computed({
  get: () => props.selected,
  set: (v) => emit('update:selected', v),
})

const joinsComplete = computed(() => {
  if (selectedList.value.length < 2) return true
  return joins.value.every((j) =>
    (j.conditions || []).some((c) => c.leftField && c.rightField)
  )
})

const allFieldOptions = computed(() =>
  selectedList.value.flatMap((de, i) => {
    const alias = aliasOf(de, i)
    return (de.fields || []).map((f) => ({
      alias,
      field: f.name,
      label: `${alias}.${f.name}`,
      deName: de.name,
    }))
  })
)

// Joins changed outside (the canvas): adopt them. Our own emits come back as the same array.
watch(() => props.joins, (v) => {
  if (Array.isArray(v) && v !== joins.value) joins.value = v
})

// Keep one join entry between each adjacent DE pair.
// A pair that was joined the other way round keeps its conditions, turned around
// (reordering, feedback #90).
watch(() => selectedList.value.map((d) => d.id).join('|'), () => {
  joins.value = joinsForOrder(selectedList.value, joins.value)
  emit('update:joins', joins.value)
  // New join rows: suggest a condition when both sides already have their fields
  // (data views have theirs at once, before this row existed).
  for (const de of selectedList.value) if (de.fields?.length || isDataView(de)) autoSuggestJoinsForDe(de.id)
}, { immediate: true })

function emitJoins() {
  joins.value = [...joins.value]
  emit('update:joins', joins.value)
}

// A data view by name (also ENT._Sent), however it was added: from the data views
// list or from a search (feedback #52).
const DATA_VIEW_NAMES = new Set([...DATA_VIEWS].map((v) => v.toUpperCase()))
const dataViewName = (de) => String(de?.name || '').replace(/^ENT\./i, '').toUpperCase()
const isDataView = (de) => !!de && (de.isDataView || de.sourceType === 'dataview' || DATA_VIEW_NAMES.has(dataViewName(de)))

async function loadFieldsForDe(de) {
  if (de.fields?.length) return de.fields
  if (isDataView(de)) {
    return DATA_VIEW_FIELDS[dataViewName(de)] || []
  }
  if (!props.stack) return []
  loadingIds.value = new Set(loadingIds.value).add(de.id)
  try {
    const data = await fetchDEFieldsCached(props.stack, de.id)
    return data?.fields || []
  } catch {
    return []
  } finally {
    const s = new Set(loadingIds.value)
    s.delete(de.id)
    loadingIds.value = s
  }
}

async function addDe(node) {
  if (selectedList.value.find((d) => d.id === node.id)) return
  // Add chip immediately; fields load in the background.
  const chip = {
    id: node.id,
    name: node.name,
    sourceType: node.sourceType,
    isDataView: node.isDataView || node.sourceType === 'dataview',
    alias: node.sourceType === 'subquery' ? node.name : smartAlias(node.name, selectedList.value.map((d, i) => aliasOf(d, i))),
    ...(node.subquery !== undefined ? { subquery: node.subquery } : {}),
    fields: node.fields || [],
    selectedFields: null, // null => SELECT *
    fieldsLoaded: false,
  }
  selectedList.value = [...selectedList.value, chip]

  const fields = await loadFieldsForDe(chip)
  const idx = selectedList.value.findIndex((d) => d.id === node.id)
  if (idx === -1) return
  const next = [...selectedList.value]
  next[idx] = { ...next[idx], fields, fieldsLoaded: true }
  selectedList.value = next
  autoSuggestJoinsForDe(node.id)
}

// Restore builder state from a saved record. Set joins/where BEFORE the
// selected list so the adjacency watcher preserves the restored conditions.
function loadState(state = {}) {
  const rawJoins = Array.isArray(state?.joins) ? state.joins : []
  joins.value = rawJoins.map((j) => ({
    ...j,
    conditions: Array.isArray(j?.conditions) ? j.conditions.map((c) => ({ ...c })) : [],
  }))
  const w = state?.where && typeof state.where === 'object' ? state.where : {}
  emit('update:joins', joins.value)
  emit('update:where', {
    combinator: w.combinator || 'AND',
    conditions: Array.isArray(w.conditions) ? w.conditions.map((c) => ({ ...c })) : [],
  })
  const o = state?.queryOptions && typeof state.queryOptions === 'object' ? state.queryOptions : {}
  emit('update:queryOptions', {
    ...defaultQueryOptions(),
    ...o,
    groupBy: Array.isArray(o.groupBy) ? o.groupBy.map((g) => ({ ...g })) : [],
    orderBy: Array.isArray(o.orderBy) ? o.orderBy.map((g) => ({ ...g })) : [],
    computedColumns: Array.isArray(o.computedColumns) ? o.computedColumns.map((c) => ({ ...c })) : [],
  })
  const des = Array.isArray(state?.selectedDEs) ? state.selectedDEs : []
  selectedList.value = des.map((d) => ({ ...d }))
}

defineExpose({ addDe, loadState })

// When a DE's fields finish loading, auto-suggest join conditions on the
// join rows it participates in (only if both sides are known and empty).
function autoSuggestJoinsForDe(deId) {
  let changed = false
  joins.value.forEach((join) => {
    if (join.leftDeId !== deId && join.rightDeId !== deId) return
    if ((join.conditions || []).some((c) => c.leftField && c.rightField)) return
    const left = selectedList.value.find((d) => d.id === join.leftDeId)
    const right = selectedList.value.find((d) => d.id === join.rightDeId)
    // Two data views have known joins, so their fields need not have loaded.
    if (!(isDataView(left) && isDataView(right)) && (!left?.fields?.length || !right?.fields?.length)) return
    const suggested = suggestJoinConditions(left, right)
    if (suggested.length) {
      join.conditions = suggested
      changed = true
    }
  })
  if (changed) emitJoins()
}

// ── Order (feedback #90): drag a DE between two others to move it, onto another
// to swap them, or use the arrows.
const dragFrom = ref(-1)
const dropTarget = ref(null) // { kind: 'gap' | 'swap', index }
const ORDER_TYPE = 'application/x-builder-de-index'
function moveTo(from, to) { selectedList.value = moveDE(selectedList.value, from, to) }
function onChipDragStart(e, idx) {
  dragFrom.value = idx
  try { e.dataTransfer.setData(ORDER_TYPE, String(idx)); e.dataTransfer.effectAllowed = 'move' } catch { /* ignore */ }
}
function onDragOver(e, kind, index) {
  if (dragFrom.value < 0) return
  e.preventDefault()
  dropTarget.value = { kind, index }
}
function onDrop(e, kind, index) {
  e.preventDefault()
  const from = dragFrom.value
  dragFrom.value = -1
  dropTarget.value = null
  if (from < 0) return
  if (kind === 'swap') selectedList.value = swapDEs(selectedList.value, from, index)
  // A gap `index` sits before item `index`; moving down removes the item first.
  else moveTo(from, index > from ? index - 1 : index)
}
function onDragEnd() { dragFrom.value = -1; dropTarget.value = null }
const isDrop = (kind, index) => dropTarget.value?.kind === kind && dropTarget.value?.index === index

function removeDe(index) {
  const next = [...selectedList.value]
  next.splice(index, 1)
  selectedList.value = next
}

function updateAlias(index, rawValue) {
  const sanitized = (rawValue || '').trim().replace(/\s+/g, '_')
  const de = selectedList.value[index]
  const oldAlias = aliasOf(de, index)
  const newAlias = sanitized || aliasFor(index)
  if (newAlias === oldAlias) return
  const next = [...selectedList.value]
  next[index] = { ...de, alias: newAlias }
  selectedList.value = next
  // Keep WHERE conditions pointing at the renamed table.
  // (nested groups too)
  const renameIn = (g) => ({
    combinator: g?.combinator || 'AND',
    conditions: (g?.conditions || []).map((c) => (c.conditions ? renameIn(c) : c.alias === oldAlias ? { ...c, alias: newAlias } : { ...c })),
  })
  emit('update:where', renameIn(props.where))
  const o = props.queryOptions || {}
  const ren = (list) => (list || []).map((g) => (g.alias === oldAlias ? { ...g, alias: newAlias } : g))
  emit('update:queryOptions', { ...o, groupBy: ren(o.groupBy), orderBy: ren(o.orderBy) })
}

// ── Fields ────────────────────────────────────────────────
function toggleFieldSection(deId) {
  const s = new Set(openFieldDEs.value)
  s.has(deId) ? s.delete(deId) : s.add(deId)
  openFieldDEs.value = s
}

function isFieldSelected(de, fieldName) {
  // null selectedFields = SELECT * => everything effectively checked
  if (de.selectedFields === null) return true
  return de.selectedFields.includes(fieldName)
}

function toggleField(deIndex, fieldName) {
  const de = selectedList.value[deIndex]
  let current = de.selectedFields === null
    ? (de.fields || []).map((f) => f.name) // materialize the implicit "all"
    : [...de.selectedFields]
  const set = new Set(current)
  set.has(fieldName) ? set.delete(fieldName) : set.add(fieldName)
  const arr = [...set]
  const allNames = (de.fields || []).map((f) => f.name)
  const next = [...selectedList.value]
  // If user re-checked everything, collapse back to null (SELECT *)
  next[deIndex] = {
    ...de,
    selectedFields: arr.length === allNames.length ? null : arr,
  }
  selectedList.value = next
}

function selectAllFields(deIndex) {
  const next = [...selectedList.value]
  next[deIndex] = { ...next[deIndex], selectedFields: null }
  selectedList.value = next
}

function selectNoneFields(deIndex) {
  const next = [...selectedList.value]
  next[deIndex] = { ...next[deIndex], selectedFields: [] }
  selectedList.value = next
}

// ── Joins ─────────────────────────────────────────────────
function updateJoinType(index, value) {
  joins.value[index].joinType = value
  emitJoins()
}
function updateCombinator(index, value) {
  joins.value[index].combinator = value
  emitJoins()
}
function addJoinCondition(index) {
  if (!joins.value[index].conditions) joins.value[index].conditions = []
  joins.value[index].conditions.push({ leftField: '', operator: '=', rightField: '' })
  emitJoins()
}
function removeJoinCondition(joinIndex, condIndex) {
  joins.value[joinIndex].conditions.splice(condIndex, 1)
  emitJoins()
}
function updateJoinCondition(joinIndex, condIndex, key, value) {
  joins.value[joinIndex].conditions[condIndex][key] = value
  emitJoins()
}
// Which earlier table a join reads from (the visual canvas can join C to A).
function updateJoinLeft(index, deId) {
  const join = joins.value[index]
  if (join.leftDeId === deId) return
  join.leftDeId = deId
  join.conditions = []
  emitJoins()
  autoSuggestJoinsForDe(deId)
}
function aliasForId(deId) {
  const i = selectedList.value.findIndex((d) => d.id === deId)
  return i < 0 ? '?' : aliasOf(selectedList.value[i], i)
}
function fieldsForDe(deId) {
  return selectedList.value.find((d) => d.id === deId)?.fields || []
}

function toggleSection(name) {
  sectionOpen.value[name] = !sectionOpen.value[name]
}
</script>

<template>
  <div class="selected-des flex flex-col h-full overflow-hidden">
    <div class="flex-1 overflow-y-auto">
      <!-- ═══ Step 1 · Structure ═══ -->
      <section class="border-b border-border">
        <button
          class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide hover:bg-muted/50"
          @click="toggleSection('structure')"
        >
          <ChevronDown v-if="sectionOpen.structure" class="h-3.5 w-3.5" />
          <ChevronRight v-else class="h-3.5 w-3.5" />
          <span>Step 1 · Query structure</span>
        </button>

        <div v-show="sectionOpen.structure" class="p-2 space-y-1">
          <div v-if="!selectedList.length" class="text-xs text-muted-foreground text-center py-8">
            Click a DE in the browser to add it to your query
          </div>

          <template v-for="(de, idx) in selectedList" :key="de.id">
            <!-- Drop here to move a DE before this one -->
            <div
              v-if="selectedList.length > 1"
              class="h-1.5 -my-0.5 rounded"
              :class="isDrop('gap', idx) ? 'bg-primary' : ''"
              @dragover="onDragOver($event, 'gap', idx)"
              @dragleave="dropTarget = null"
              @drop="onDrop($event, 'gap', idx)"
            />
            <!-- DE chip (drag onto another to swap) -->
            <div
              class="rounded-lg border bg-card px-2.5 py-2 flex items-center justify-between"
              :class="[isDrop('swap', idx) && dragFrom !== idx ? 'border-primary ring-1 ring-primary' : 'border-border', dragFrom === idx ? 'opacity-50' : '']"
              :draggable="selectedList.length > 1"
              @dragstart="onChipDragStart($event, idx)"
              @dragend="onDragEnd"
              @dragover="onDragOver($event, 'swap', idx)"
              @drop="onDrop($event, 'swap', idx)"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <GripVertical v-if="selectedList.length > 1" class="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-grab" title="Drag to move, or drop on another to swap" />
                <input
                  class="w-10 text-[10px] font-mono text-center text-primary border border-border rounded px-0.5 py-0.5 bg-background focus:border-primary focus:outline-none"
                  :value="aliasOf(de, idx)"
                  title="Table alias — edit to rename"
                  @change="updateAlias(idx, $event.target.value)"
                />
                <span class="text-xs font-bold text-foreground truncate">{{ de.name }}</span>
                <span class="text-[9px] px-1 rounded bg-muted text-muted-foreground shrink-0">{{ de.sourceType }}</span>
                <Loader2 v-if="loadingIds.has(de.id)" class="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
              </div>
              <div class="flex items-center shrink-0">
                <template v-if="selectedList.length > 1">
                  <Button variant="ghost" size="icon" class="h-6 w-6" :disabled="idx === 0" title="Move up" aria-label="Move up" @click="moveTo(idx, idx - 1)">
                    <ArrowUp class="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" class="h-6 w-6" :disabled="idx === selectedList.length - 1" title="Move down" aria-label="Move down" @click="moveTo(idx, idx + 1)">
                    <ArrowDown class="h-3 w-3" />
                  </Button>
                </template>
                <Button variant="ghost" size="icon" class="h-6 w-6" title="Remove data extension" @click="removeDe(idx)">
                  <X class="h-3 w-3" />
                </Button>
              </div>
            </div>

            <!-- Join row to next DE -->
            <div
              v-if="idx < selectedList.length - 1 && joins[idx]"
              class="ml-3 pl-3 border-l-2 border-dashed border-border py-2 space-y-1.5"
            >
              <div class="flex items-center gap-1">
                <select
                  class="text-[10px] font-semibold border rounded px-1 py-0.5 bg-background"
                  :value="joins[idx].joinType"
                  @change="updateJoinType(idx, $event.target.value)"
                >
                  <option>INNER JOIN</option>
                  <option>LEFT JOIN</option>
                  <option>RIGHT JOIN</option>
                  <option>FULL OUTER JOIN</option>
                </select>
                <span class="text-[10px] text-muted-foreground truncate">{{ selectedList[idx + 1].name }} on</span>
                <select
                  v-if="idx > 0"
                  class="text-[10px] border rounded px-1 py-0.5 bg-background min-w-0"
                  title="The earlier table this one joins to"
                  :value="joins[idx].leftDeId"
                  @change="updateJoinLeft(idx, $event.target.value)"
                >
                  <option v-for="(e, ei) in selectedList.slice(0, idx + 1)" :key="e.id" :value="e.id">{{ aliasOf(e, ei) }} · {{ e.name }}</option>
                </select>
                <span v-else class="text-[10px] text-muted-foreground truncate">{{ aliasOf(selectedList[0], 0) }}</span>
              </div>

              <!-- Condition rows -->
              <div
                v-for="(cond, cIdx) in joins[idx].conditions"
                :key="cIdx"
                class="flex items-center gap-1"
              >
                <select
                  class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
                  :value="cond.leftField"
                  @change="updateJoinCondition(idx, cIdx, 'leftField', $event.target.value)"
                >
                  <option value="" disabled>{{ aliasForId(cond.leftDeId || joins[idx].leftDeId) }}.field…</option>
                  <option v-for="f in fieldsForDe(cond.leftDeId || joins[idx].leftDeId)" :key="f.name" :value="f.name">{{ cond.leftDeId ? aliasForId(cond.leftDeId) + '.' : '' }}{{ f.name }}</option>
                </select>
                <select
                  class="text-[10px] border rounded px-0.5 py-0.5 bg-background"
                  :value="cond.operator"
                  @change="updateJoinCondition(idx, cIdx, 'operator', $event.target.value)"
                >
                  <option v-for="op in JOIN_OPERATORS" :key="op">{{ op }}</option>
                </select>
                <select
                  class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
                  :value="cond.rightField"
                  @change="updateJoinCondition(idx, cIdx, 'rightField', $event.target.value)"
                >
                  <option value="" disabled>{{ aliasOf(selectedList[idx + 1], idx + 1) }}.field…</option>
                  <option v-for="f in fieldsForDe(joins[idx].rightDeId)" :key="f.name" :value="f.name">{{ f.name }}</option>
                </select>
                <Button variant="ghost" size="icon" class="h-5 w-5 shrink-0" title="Remove join condition" @click="removeJoinCondition(idx, cIdx)">
                  <X class="h-2.5 w-2.5" />
                </Button>
              </div>

              <div class="flex items-center gap-2">
                <button
                  class="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                  @click="addJoinCondition(idx)"
                >
                  <Plus class="h-2.5 w-2.5" /> Add condition
                </button>
                <div v-if="(joins[idx].conditions || []).length > 1" class="flex items-center gap-1">
                  <span class="text-[9px] text-muted-foreground">Match:</span>
                  <select
                    class="text-[10px] border rounded px-1 py-0.5 bg-background"
                    :value="joins[idx].combinator"
                    @change="updateCombinator(idx, $event.target.value)"
                  >
                    <option value="AND">All (AND)</option>
                    <option value="OR">Any (OR)</option>
                  </select>
                </div>
              </div>
              <div
                v-if="!(joins[idx].conditions || []).some((c) => c.leftField && c.rightField)"
                class="text-[9px] text-amber-600"
              >
                ⚠ Join condition incomplete
              </div>
            </div>
          </template>
          <!-- Drop here to move a DE to the end -->
          <div
            v-if="selectedList.length > 1"
            class="h-1.5 rounded"
            :class="isDrop('gap', selectedList.length) ? 'bg-primary' : ''"
            @dragover="onDragOver($event, 'gap', selectedList.length)"
            @dragleave="dropTarget = null"
            @drop="onDrop($event, 'gap', selectedList.length)"
          />
        </div>
      </section>

      <!-- ═══ Step 2 · Fields ═══ -->
      <section class="border-b border-border">
        <button
          class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wide hover:bg-muted/50"
          :class="joinsComplete ? 'text-muted-foreground' : 'text-muted-foreground/40'"
          :disabled="!joinsComplete"
          @click="joinsComplete && toggleSection('fields')"
        >
          <ChevronDown v-if="sectionOpen.fields && joinsComplete" class="h-3.5 w-3.5" />
          <ChevronRight v-else class="h-3.5 w-3.5" />
          <span>Step 2 · Output fields</span>
          <Lock v-if="!joinsComplete" class="h-3 w-3 ml-auto" />
        </button>

        <div v-show="sectionOpen.fields && joinsComplete" class="p-2 space-y-1.5">
          <div v-if="!selectedList.length" class="text-[11px] text-muted-foreground text-center py-4">
            Add DEs first
          </div>
          <details v-if="selectedList.length" class="rounded-lg border border-border px-2 py-1">
            <summary class="text-[11px] font-bold cursor-pointer">Output columns: order and names</summary>
            <div class="pt-1.5">
              <OutputColumns
                :selected-d-es="selectedList"
                :query-options="queryOptions"
                @update:selected-d-es="selectedList = $event"
                @update:query-options="emit('update:queryOptions', $event)"
              />
            </div>
          </details>
          <div v-for="(de, idx) in selectedList" :key="de.id" class="rounded-lg border border-border">
            <button
              class="w-full flex items-center justify-between px-2 py-1.5 hover:bg-muted/50"
              @click="toggleFieldSection(de.id)"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <ChevronDown v-if="openFieldDEs.has(de.id)" class="h-3 w-3 shrink-0" />
                <ChevronRight v-else class="h-3 w-3 shrink-0" />
                <span class="text-[11px] font-bold truncate">{{ de.name }}</span>
              </div>
              <span class="text-[9px] text-muted-foreground shrink-0">
                {{ de.selectedFields === null ? 'All fields (*)' : de.selectedFields.length + ' selected' }}
              </span>
            </button>

            <div v-if="openFieldDEs.has(de.id)" class="px-2 pb-2">
              <div class="flex gap-2 mb-1">
                <button class="text-[9px] text-primary hover:underline" @click="selectAllFields(idx)">Select all</button>
                <button class="text-[9px] text-primary hover:underline" @click="selectNoneFields(idx)">Select none</button>
              </div>
              <div v-if="loadingIds.has(de.id)" class="flex items-center gap-1 text-[10px] text-muted-foreground py-2">
                <Loader2 class="h-3 w-3 animate-spin" /> Loading fields…
              </div>
              <div v-else-if="!(de.fields || []).length" class="text-[10px] text-muted-foreground py-2">
                No fields found
              </div>
              <div v-else class="max-h-40 overflow-y-auto grid grid-cols-2 gap-0.5">
                <label
                  v-for="f in de.fields"
                  :key="f.name"
                  class="flex items-center gap-1 text-[10px] cursor-pointer hover:bg-muted rounded px-1"
                >
                  <input
                    type="checkbox"
                    class="h-3 w-3"
                    :checked="isFieldSelected(de, f.name)"
                    @change="toggleField(idx, f.name)"
                  />
                  <span class="truncate">{{ f.name }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══ Step 3 · Filters ═══ -->
      <section>
        <button
          class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wide hover:bg-muted/50"
          :class="joinsComplete ? 'text-muted-foreground' : 'text-muted-foreground/40'"
          :disabled="!joinsComplete"
          @click="joinsComplete && toggleSection('filters')"
        >
          <ChevronDown v-if="sectionOpen.filters && joinsComplete" class="h-3.5 w-3.5" />
          <ChevronRight v-else class="h-3.5 w-3.5" />
          <span>Step 3 · Filters (WHERE)</span>
          <Lock v-if="!joinsComplete" class="h-3 w-3 ml-auto" />
        </button>

        <div v-show="sectionOpen.filters && joinsComplete" class="p-2">
          <WhereBuilder
            :field-options="allFieldOptions"
            :model-value="where"
            @update:model-value="emit('update:where', $event)"
          />
        </div>
      </section>

      <!-- ═══ Step 4 · Options ═══ -->
      <section class="border-t border-border">
        <button
          class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
          @click="toggleSection('options')"
        >
          <ChevronDown v-if="sectionOpen.options" class="h-3.5 w-3.5" />
          <ChevronRight v-else class="h-3.5 w-3.5" />
          <span>Step 4 · Options</span>
        </button>
        <div v-show="sectionOpen.options" class="p-2">
          <QueryOptions
            :field-options="allFieldOptions"
            :model-value="queryOptions"
            @update:model-value="emit('update:queryOptions', $event)"
          />
        </div>
      </section>
    </div>
  </div>
</template>
