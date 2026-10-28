<script setup>
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Download, FileText, Copy, Check, Loader2, ArrowUp, ArrowDown, ArrowUpDown, ListFilter, FileSpreadsheet, ChartBar } from 'lucide-vue-next'
import ColumnValues from '@/components/detail/ColumnValues.vue'
import { applyValueFilters, valueFiltering } from '@/utils/columnValues.js'
import { buildResultsMarkdown, MARKDOWN_ROW_LIMIT } from '@/utils/markdownExport.js'
import { sortRows, filterRows, nextSort } from '@/utils/tableSort.js'
import { rowsAsTsv, rangeSelect } from '@/utils/rowSelection.js'
import { downloadWorkbook } from '@/utils/exportDoc.js'
import { showToast } from '@/composables/useToast.js'
import { useStack } from '@/composables/useStack.js'
import { exportBaseName } from '@/utils/exportName.js'
import Button from '@/components/ui/button/Button.vue'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table/index.js'

const PAGE_SIZE = 50

const props = defineProps({
  rows:     { type: Array,  default: () => [] },
  columns:  { type: Array,  default: () => [] },
  filename: { type: String, default: 'results' },
  sql:      { type: String, default: '' },
  totalCount: { type: Number, default: null },
  // Loading more than the first page of the target DE (Run Query).
  canLoadMore: { type: Boolean, default: false },
  loadingMore: { type: Boolean, default: false },
  loadAllLimit: { type: Number, default: 50000 },
  // File names start with this (Run Query: query-<name>; DE rows: de-<name>).
  filePrefix: { type: String, default: 'query' },
  // Tick rows to copy or download only those (feedback #138, Preview data).
  selectable: { type: Boolean, default: false },
  // The column values panel offers SFMC queries over the whole DE (Preview data, #1012).
  sfmcValues: { type: Boolean, default: false },
})
const emit = defineEmits(['load-more', 'load-all', 'values-query'])

const total = computed(() => props.totalCount ?? props.rows.length)
// Zero rows can still be exported: the SQL, the columns and "0 rows" (feedback #31).
const canExport = computed(() => props.rows.length > 0 || props.columns.length > 0 || !!props.sql.trim())
const moreToLoad = computed(() => props.canLoadMore && total.value > props.rows.length)

// Sort by a header click and filter per column (feedback #126, #138), on the rows loaded.
const sort = ref(null)
const filters = ref({})
const filtersOpen = ref(false)
const colDefs = computed(() => props.columns.map((c) => ({ key: c, label: c })))
// Each column's values (feedback #1012): ticked values and "Duplicates only".
const picks = ref({})
const dups = ref({})
const valuesOpen = ref(null)
const textFiltered = computed(() => filterRows(props.rows, colDefs.value, filters.value))
const valuesFiltering = computed(() => valueFiltering(picks.value, dups.value))
const filtering = computed(() => Object.values(filters.value).some((v) => String(v || '').trim()) || valuesFiltering.value)
const viewRows = computed(() => sortRows(applyValueFilters(textFiltered.value, picks.value, dups.value), colDefs.value, sort.value))
// A column's list counts the rows every other filter keeps.
const valuesBase = (col) => applyValueFilters(textFiltered.value, picks.value, dups.value, col)
const hasValueFilter = (col) => !!(picks.value[col]?.length || dups.value[col])
function clickHeader(col) { sort.value = nextSort(sort.value, col); page.value = 0 }
function toggleValues(col) { valuesOpen.value = valuesOpen.value === col ? null : col }
function clearValueFilters() { picks.value = {}; dups.value = {} }
watch(filters, () => { page.value = 0 }, { deep: true })
watch([picks, dups], () => { page.value = 0 }, { deep: true })
// Columns that go away take their value filters with them.
watch(() => props.columns, (cols) => {
  const have = new Set(cols)
  const keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => have.has(k)))
  if (Object.keys(picks.value).some((k) => !have.has(k))) picks.value = keep(picks.value)
  if (Object.keys(dups.value).some((k) => !have.has(k))) dups.value = keep(dups.value)
  if (valuesOpen.value && !have.has(valuesOpen.value)) valuesOpen.value = null
})

const page = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(viewRows.value.length / PAGE_SIZE)))
const visibleRows = computed(() =>
  viewRows.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE)
)

// Ticked rows, by row object; a reload brings new objects and so clears them.
const picked = ref(new Set())
let lastPicked = -1
watch(() => props.rows, (rows) => {
  if (!picked.value.size) return
  const have = new Set(rows)
  picked.value = new Set([...picked.value].filter((r) => have.has(r)))
})
const pickedRows = computed(() => viewRows.value.filter((r) => picked.value.has(r)))
const allViewPicked = computed(() => viewRows.value.length > 0 && viewRows.value.every((r) => picked.value.has(r)))
function togglePick(row, e) {
  const i = viewRows.value.indexOf(row)
  picked.value = rangeSelect(picked.value, viewRows.value, i, e?.shiftKey ? lastPicked : -1)
  lastPicked = i
}
function togglePickAll() {
  picked.value = allViewPicked.value ? new Set() : new Set(viewRows.value)
}
// Exports cover the ticked rows when there are any, else the rows shown.
const exportRows = computed(() => (pickedRows.value.length ? pickedRows.value : viewRows.value))
async function copyPicked() {
  try {
    await navigator.clipboard.writeText(rowsAsTsv(props.columns, pickedRows.value))
    showToast(`Copied ${pickedRows.value.length} row(s) with the header; paste into Excel or Sheets.`)
  } catch (e) {
    showToast(`Could not copy: ${e.message}`)
  }
}
async function downloadExcel() {
  try {
    const { stack } = useStack()
    await downloadWorkbook([{ name: props.filename || 'Rows', columns: props.columns, rows: exportRows.value.map((r) => props.columns.map((c) => r[c] ?? '')) }],
      `${await exportBaseName(stack.value, `${props.filePrefix}-${props.filename || 'results'}`)}.xlsx`)
  } catch (e) {
    showToast(`Export failed: ${e.message}`)
  }
}

async function saveBlob(content, type, ext) {
  // The stack is only needed for the file name, so the table works without chrome APIs.
  const { stack } = useStack()
  const blob = new Blob([content], { type })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${await exportBaseName(stack.value, `${props.filePrefix}-${props.filename || 'results'}`)}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

function markdown() {
  return buildResultsMarkdown({
    title: props.filename, sql: props.sql, columns: props.columns, rows: exportRows.value,
    totalCount: pickedRows.value.length || filtering.value ? exportRows.value.length : (props.totalCount ?? props.rows.length),
  })
}

function downloadMarkdown() {
  saveBlob(markdown(), 'text/markdown', 'md')
}

// "Copy for AI": the same Markdown, straight to the clipboard.
const copied = ref(false)
async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(markdown())
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {}
}

function downloadCSV() {
  const escape = (val) => {
    const s = val == null ? '' : String(val)
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    props.columns.join(','),
    ...exportRows.value.map(row => props.columns.map(col => escape(row[col])).join(',')),
  ]
  saveBlob(lines.join('\n'), 'text/csv', 'csv')
}
</script>

<template>
  <div class="flex flex-col flex-1 overflow-hidden min-h-0">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-4 py-2 bg-card border-b border-border shrink-0">
      <span class="text-xs font-bold text-foreground">
        <template v-if="filtering">{{ viewRows.length.toLocaleString() }} of {{ rows.length.toLocaleString() }} loaded rows (filtered)<button v-if="valuesFiltering" class="ml-1 font-normal text-primary hover:underline" @click="clearValueFilters">Clear value filters</button></template>
        <template v-else-if="total > rows.length">Showing {{ rows.length.toLocaleString() }} of {{ total.toLocaleString() }} rows</template>
        <template v-else>{{ rows.length.toLocaleString() }} rows</template>
        <template v-if="selectable && picked.size"> · {{ pickedRows.length.toLocaleString() }} ticked
          <button class="ml-1 font-normal text-primary hover:underline" @click="copyPicked">Copy</button>
          <button class="ml-1 font-normal text-primary hover:underline" @click="picked = new Set()">Clear</button>
        </template>
      </span>
      <div v-if="moreToLoad" class="flex items-center gap-1.5 ml-3 mr-auto">
        <Button variant="outline" size="sm" class="h-7 text-[11px]" :disabled="loadingMore" @click="emit('load-more')">
          <Loader2 v-if="loadingMore" class="h-3 w-3 mr-1 animate-spin" /> Load next {{ Math.min(2500, total - rows.length).toLocaleString() }}
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-[11px]" :disabled="loadingMore" @click="emit('load-all')"
          :title="total > loadAllLimit ? `Loads up to ${loadAllLimit.toLocaleString()} rows; export the target data extension in SFMC for all of them` : 'Loads every row'">
          Load all{{ total > loadAllLimit ? ` (up to ${loadAllLimit.toLocaleString()})` : '' }}
        </Button>
        <ProgressBar v-if="loadingMore" :value="rows.length" :max="Math.min(total, loadAllLimit)" aria-label="Loading rows" class="w-32" />
      </div>

      <div class="flex items-center gap-2">
        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Button variant="ghost" size="icon" class="h-7 w-7" title="Previous page" @click="page--" :disabled="page === 0">
            <ChevronLeft class="h-3.5 w-3.5" />
          </Button>
          <span class="tabular-nums">{{ page + 1 }} / {{ totalPages }}</span>
          <Button variant="ghost" size="icon" class="h-7 w-7" title="Next page" @click="page++" :disabled="page >= totalPages - 1">
            <ChevronRight class="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button variant="outline" size="sm" class="h-7 text-xs gap-1.5" :class="filtersOpen || filtering ? 'bg-accent' : ''" :aria-pressed="filtersOpen"
          :disabled="columns.length === 0" title="A filter box for each column" @click="filtersOpen = !filtersOpen">
          <ListFilter class="h-3 w-3" /> Filters
        </Button>
        <!-- CSV download -->
        <Button variant="outline" size="sm" :disabled="columns.length === 0" @click="downloadCSV"
          class="h-7 text-xs gap-1.5">
          <Download class="h-3 w-3" />
          CSV{{ selectable && pickedRows.length ? ` (${pickedRows.length})` : '' }}
        </Button>
        <Button v-if="selectable" variant="outline" size="sm" :disabled="columns.length === 0" @click="downloadExcel" class="h-7 text-xs gap-1.5">
          <FileSpreadsheet class="h-3 w-3" />
          Excel{{ pickedRows.length ? ` (${pickedRows.length})` : '' }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!canExport" @click="downloadMarkdown"
          class="h-7 text-xs gap-1.5" :title="`Download the SQL and up to ${MARKDOWN_ROW_LIMIT} rows as Markdown`">
          <FileText class="h-3 w-3" />
          MD
        </Button>
        <Button variant="outline" size="sm" :disabled="!canExport" @click="copyMarkdown"
          class="h-7 text-xs gap-1.5" title="Copy the SQL and results as Markdown, to paste into Claude or ChatGPT">
          <Check v-if="copied" class="h-3 w-3" />
          <Copy v-else class="h-3 w-3" />
          {{ copied ? 'Copied' : 'Copy for AI' }}
        </Button>
      </div>
    </div>

    <!-- Table scroll area -->
    <div class="flex-1 overflow-auto min-h-0">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th v-if="selectable" class="w-8 px-2 py-2 bg-muted border-b-2 border-border sticky top-0 z-10">
              <input type="checkbox" :checked="allViewPicked" aria-label="Tick every row shown" @change="togglePickAll" />
            </th>
            <th v-for="col in columns" :key="col" :aria-sort="sort?.key === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'"
              class="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground bg-muted border-b-2 border-border border-r border-r-border/60 last:border-r-0 sticky top-0 whitespace-nowrap"
              :class="valuesOpen === col ? 'z-20' : 'z-10'">
              <div class="relative inline-flex items-center gap-1">
                <button class="inline-flex items-center gap-1 hover:text-foreground" :title="`Sort by ${col}`" @click="clickHeader(col)">
                  {{ col }}
                  <ArrowUp v-if="sort?.key === col && sort.dir === 'asc'" class="h-3 w-3" />
                  <ArrowDown v-else-if="sort?.key === col" class="h-3 w-3" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-30" />
                </button>
                <button data-values-toggle class="rounded p-0.5 hover:text-foreground hover:bg-accent" :class="hasValueFilter(col) ? 'text-primary' : 'opacity-40 hover:opacity-100'"
                  :title="`Values of ${col}: distinct values, counts, duplicates`" :aria-label="`Values of ${col}`" :aria-expanded="valuesOpen === col" @click="toggleValues(col)">
                  <ChartBar class="h-3 w-3" />
                </button>
                <ColumnValues v-if="valuesOpen === col" :col="col" :rows="valuesBase(col)"
                  :picked="picks[col] || []" :dups="!!dups[col]" :partial="total > rows.length" :sfmc="sfmcValues"
                  @update:picked="picks = { ...picks, [col]: $event }" @update:dups="dups = { ...dups, [col]: $event }"
                  @close="valuesOpen = null" @query="emit('values-query', { col, kind: $event }); valuesOpen = null" />
              </div>
            </th>
          </tr>
          <tr v-if="filtersOpen">
            <th v-if="selectable" class="bg-muted border-b border-border sticky top-8 z-10" />
            <th v-for="col in columns" :key="col" class="px-1 py-1 bg-muted border-b border-border sticky top-8 z-10">
              <input v-model="filters[col]" type="search" :aria-label="`Filter ${col}`" placeholder="Filter"
                class="h-6 w-full min-w-16 rounded border border-border bg-background px-1.5 text-[11px] font-normal" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in visibleRows" :key="i"
            class="border-b border-border/50 hover:bg-muted/40 transition-colors" :class="selectable && picked.has(row) ? 'bg-primary/5' : ''">
            <td v-if="selectable" class="px-2 py-1.5">
              <input type="checkbox" :checked="picked.has(row)" :aria-label="`Tick row ${page * PAGE_SIZE + i + 1}`" @click="togglePick(row, $event)" />
            </td>
            <td v-for="col in columns" :key="col"
              class="px-3 py-1.5 text-foreground border-r border-border/30 last:border-r-0">
              {{ row[col] ?? '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
