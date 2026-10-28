<script setup>
// Result table shared by the Automation, Activity, DE, Journey and CloudPage screens.
// Columns can be hidden (remembered per table in localStorage, like Automation
// Viewer's Columns menu). Cells render with a `cell-<key>` slot when one is given;
// a row whose key is in `expanded` gets a full-width `expanded` slot below it.
// Headers render with a `head-<key>` slot when one is given.
// Click a header to sort (ascending, descending, off; remembered per table) and
// open Filters for a box per column (feedback #126, utils/tableSort.js). Both work
// on the rows loaded so far; `shown` reports the rows left after filtering.
import { computed, ref, watch } from 'vue'
import { Columns3, ArrowUp, ArrowDown, ArrowUpDown, Filter, X } from 'lucide-vue-next'
import { sortRows, filterRows, nextSort, isSortable, isFilterable } from '@/utils/tableSort.js'

const props = defineProps({
  columns: { type: Array, required: true }, // [{ key, label, class?, hideable? }]
  rows: { type: Array, required: true },
  rowKey: { type: String, default: 'id' },
  storageKey: { type: String, default: '' },
  expanded: { type: Set, default: () => new Set() },
  emptyText: { type: String, default: 'Nothing to show.' },
})
const emit = defineEmits(['shown'])

const hidden = ref(new Set())
try {
  const saved = props.storageKey && JSON.parse(localStorage.getItem(`toolkit_cols_${props.storageKey}`) || '[]')
  if (Array.isArray(saved)) hidden.value = new Set(saved)
} catch { /* storage blocked */ }

const visible = computed(() => props.columns.filter((c) => !hidden.value.has(c.key)))
const menuOpen = ref(false)

const sort = ref(null)
try {
  const saved = props.storageKey && JSON.parse(localStorage.getItem(`toolkit_sort_${props.storageKey}`) || 'null')
  if (saved?.key && props.columns.some((c) => c.key === saved.key && isSortable(c))) sort.value = saved
} catch { /* storage blocked */ }
function sortBy(c) {
  if (!isSortable(c)) return
  sort.value = nextSort(sort.value, c.key)
  try { if (props.storageKey) localStorage.setItem(`toolkit_sort_${props.storageKey}`, JSON.stringify(sort.value)) } catch { /* storage blocked */ }
}
const ariaSort = (c) => (sort.value?.key === c.key ? (sort.value.dir === 'asc' ? 'ascending' : 'descending') : isSortable(c) ? 'none' : undefined)

const filtersOpen = ref(false)
const filters = ref({})
const filtering = computed(() => Object.values(filters.value).some((v) => (v || '').trim()))
function clearFilters() { filters.value = {} }
function toggleFilters() {
  filtersOpen.value = !filtersOpen.value
  if (!filtersOpen.value) clearFilters()
}

const shownRows = computed(() => sortRows(filterRows(props.rows, props.columns, filters.value), props.columns, sort.value))
watch(shownRows, (list) => emit('shown', filtering.value ? list : null), { immediate: true })

function toggle(key) {
  const next = new Set(hidden.value)
  next.has(key) ? next.delete(key) : next.add(key)
  hidden.value = next
  try { if (props.storageKey) localStorage.setItem(`toolkit_cols_${props.storageKey}`, JSON.stringify([...next])) } catch { /* storage blocked */ }
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card">
    <div class="flex items-center justify-end gap-1 px-2 pt-2 relative">
      <span v-if="filtering" class="flex-1 text-xs text-muted-foreground">{{ shownRows.length.toLocaleString() }} of {{ rows.length.toLocaleString() }} shown (filtered)
        <button class="ml-1 text-primary hover:underline" @click="clearFilters">Clear filters</button></span>
      <button v-if="columns.some(isFilterable)" class="flex items-center gap-1 h-7 px-2 rounded text-xs hover:bg-accent"
        :class="filtersOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'" :aria-pressed="filtersOpen" @click="toggleFilters">
        <Filter class="h-3.5 w-3.5" /> Filters
      </button>
      <button v-if="columns.some((c) => c.hideable !== false)" class="flex items-center gap-1 h-7 px-2 rounded text-xs text-muted-foreground hover:bg-accent" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
        <Columns3 class="h-3.5 w-3.5" /> Columns
      </button>
      <template v-if="menuOpen && columns.some((c) => c.hideable !== false)">
        <div class="fixed inset-0 z-30" @click="menuOpen = false" />
        <div class="absolute right-2 top-9 z-40 w-48 rounded-md border border-border bg-popover shadow-lg py-1">
          <label v-for="c in columns.filter((c) => c.hideable !== false)" :key="c.key" class="flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent cursor-pointer">
            <input type="checkbox" :checked="!hidden.has(c.key)" @change="toggle(c.key)" /> {{ c.label }}
          </label>
        </div>
      </template>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-border text-left text-muted-foreground">
            <th v-for="c in visible" :key="c.key" class="px-3 py-2 font-semibold whitespace-nowrap" :class="c.class" :aria-sort="ariaSort(c)">
              <slot :name="`head-${c.key}`">
                <button v-if="isSortable(c)" type="button" class="group inline-flex items-center gap-1 hover:text-foreground" :class="sort?.key === c.key ? 'text-foreground' : ''"
                  :title="`Sort by ${c.label}`" @click="sortBy(c)">
                  {{ c.label }}
                  <ArrowUp v-if="sort?.key === c.key && sort.dir === 'asc'" class="h-3 w-3" aria-hidden="true" />
                  <ArrowDown v-else-if="sort?.key === c.key" class="h-3 w-3" aria-hidden="true" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-0 group-hover:opacity-60" aria-hidden="true" />
                </button>
                <template v-else>{{ c.label }}</template>
              </slot>
            </th>
          </tr>
          <tr v-if="filtersOpen" class="border-b border-border">
            <th v-for="c in visible" :key="c.key" class="px-2 py-1 font-normal">
              <div v-if="isFilterable(c)" class="relative">
                <input v-model="filters[c.key]" type="search" :placeholder="`Filter ${c.label}`" :aria-label="`Filter ${c.label}`"
                  class="h-6 w-full min-w-16 rounded border border-border bg-background px-1.5 pr-5 text-[11px]" />
                <button v-if="filters[c.key]" type="button" class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  :aria-label="`Clear the ${c.label} filter`" @click="filters[c.key] = ''"><X class="h-3 w-3" /></button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length"><td :colspan="visible.length" class="px-3 py-6 text-center text-muted-foreground">{{ emptyText }}</td></tr>
          <tr v-else-if="!shownRows.length"><td :colspan="visible.length" class="px-3 py-6 text-center text-muted-foreground">No rows match the filters.</td></tr>
          <template v-for="row in shownRows" :key="row[rowKey]">
            <tr class="border-b border-border last:border-0 hover:bg-muted/40 align-top">
              <td v-for="c in visible" :key="c.key" class="px-3 py-2" :class="c.class">
                <slot :name="`cell-${c.key}`" :row="row">{{ row[c.key] ?? '' }}</slot>
              </td>
            </tr>
            <tr v-if="expanded.has(row[rowKey])" class="border-b border-border bg-muted/20">
              <td :colspan="visible.length" class="px-3 py-3"><slot name="expanded" :row="row" /></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
