<script setup>
// Data Extensions (SFMC Automation Viewer's Data Extension Finder): search local,
// Shared and Synchronized DEs, see folder paths and fields, tick fields to build a
// query, export to Excel or a document.
import ReportErrorButton from '@/components/results/ReportErrorButton.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, reactive, ref, watch } from 'vue'
import ContentFolderTree from '@/components/content/ContentFolderTree.vue'
import { deFolderLoader } from '@/utils/folderLoaders.js'
import { useRouter } from 'vue-router'
import { Search, Loader2, RefreshCw, FolderTree, ListTree, FileSpreadsheet, Copy, Play, X, ChevronDown, ChevronRight, Network, ExternalLink, Rows3, ArrowUpDown, Database, Plus, KeyRound } from 'lucide-vue-next'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import ReorderFieldsDialog from '@/components/data/ReorderFieldsDialog.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useUsage } from '@/composables/useUsage.js'
import { useStack, whenStack } from '@/composables/useStack.js'
import { exportBaseName } from '@/utils/exportName.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { showToast } from '@/composables/useToast.js'
import { searchLocalDEs, searchSharedSyncDEs, mergeDEPages, fetchDEFieldList, fetchDEFolderPath, fetchDEDetail, deRowCountOf, clearDECaches, filterDEList, fieldTypeLabel, deContactBuilderUrl, DE_PAGE_SIZE } from '@/utils/deApi.js'
import { clearSharedDECache } from '@/utils/sfmcApi.js'
import { buildDESelect } from '@/utils/deSql.js'
import { runInBatches } from '@/utils/batchRunner.js'
import { downloadWorkbook } from '@/utils/exportDoc.js'
import { formatDateTime } from '@/utils/format.js'

const router = useRouter()
const { stack } = useStack()
const usage = useUsage()
const whereUsed = (de) => usage.start(stack.value, { kind: 'de', de })
const whereFieldUsed = (de, field) => usage.start(stack.value, { kind: 'field', de, field })

// Preview data opens as its own page (feedback #117, #1097).
const previewTo = (de) => ({
  path: '/data-extensions/preview',
  query: { id: de.id, key: de.customerKey, name: de.name, ...(de.sourceType ? { source: de.sourceType } : {}) },
})
// The DE whose columns are being reordered (feedback #1013).
// Turned off for now (feedback #1033: does not work yet); the dialog and code stay.
const REORDER_ENABLED = false
const reorderDE = ref(null)
function afterReorder(de) {
  clearDECaches()
  delete fields[de.id]
  loadFields(de)
}

const query = ref('')
const searched = ref(null) // the query of the results shown, null before any search
const listFolder = ref(null) // folder id the results list in full (#1119), else null
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const hideSystem = ref(false)
// Common search criteria (feedback #1004), remembered in localStorage.
function readPref(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }
function writePref(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }
const sourceFilter = ref(readPref('toolkit_deSource', 'all'))
const hideQueryStudio = ref(readPref('toolkit_deHideQS', false))
watch(hideQueryStudio, (v) => writePref('toolkit_deHideQS', v))
watch(sourceFilter, (v) => {
  writePref('toolkit_deSource', v)
  if (searched.value !== null) search()
})
const wantsLocal = computed(() => !!folder.value || sourceFilter.value === 'all' || sourceFilter.value === 'local')
// Folder tree (feedback #1065): a folder lists its own data extensions; the Shared and
// Synchronized search (it walks every shared folder) is left out then.
const folder = ref(null)
const folderLoad = computed(() => (stack.value ? deFolderLoader(stack.value) : null))
watch(folder, () => search())
const wantsShared = computed(() => sourceFilter.value !== 'local' && !folder.value)

// Local DEs come 50 a page, straight away; Shared and Synchronized DEs need a folder
// walk, so they load in the background and are slotted in by date (mergeDEPages).
const local = ref([])
const localTotal = ref(0) // SFMC's count for what was sent (see deSearchTerms)
const localPage = ref(0)
const localFetched = ref(0) // rows SFMC returned, before the local filter
const localFiltered = ref(false)
const shared = ref(null) // null while loading
const sharedError = ref('')
const limit = ref(DE_PAGE_SIZE)
let searchId = 0

const localDone = computed(() => localFetched.value >= localTotal.value)
const merged = computed(() => mergeDEPages({ local: local.value, localDone: localDone.value, shared: shared.value || [], limit: limit.value }))
const results = computed(() => merged.value.visible)
const total = computed(() => (localFiltered.value ? local.value.length : localTotal.value) - merged.value.duplicates + (shared.value?.length || 0))
// With a local filter the count is only known once every page is in.
const totalIsPartial = computed(() => shared.value === null || (localFiltered.value && !localDone.value))

// Per-DE state, keyed by DE id.
const fields = reactive({}) // id → { status: 'loading' | 'ok' | 'error', list, error }
const paths = reactive({}) // id → { status, path, error }
const counts = reactive({}) // id → { status, count, error }
const expanded = ref(new Set())
const selected = ref(new Map()) // id → { de, fields: Set } in the order first ticked (query building)
const picked = ref(new Set()) // ids of rows ticked for Download and Excel

const shown = computed(() => filterDEList(results.value, { source: sourceFilter.value, hideSystem: hideSystem.value, hideQueryStudio: hideQueryStudio.value }))
const canLoadMore = computed(() => searched.value !== null && merged.value.hasMore)
// Exports cover the ticked rows when there are any, else everything shown.
const exportList = computed(() => (picked.value.size ? shown.value.filter((d) => picked.value.has(d.id)) : shown.value))
const filtered = ref(null) // rows left by the table's column filters, null when none (#126)
const pickable = computed(() => filtered.value || shown.value)
const allPicked = computed(() => pickable.value.length > 0 && pickable.value.every((d) => picked.value.has(d.id)))

async function loadLocalPage(id) {
  const r = await searchLocalDEs(stack.value, searched.value, localPage.value + 1, folder.value?.id || 0)
  if (id !== searchId) return
  const have = new Set(local.value.map((d) => d.id))
  local.value = [...local.value, ...r.items.filter((d) => !have.has(d.id))]
  localFetched.value += r.fetched
  localFiltered.value = r.filtered
  localTotal.value = r.fetched ? r.total : localFetched.value
  localPage.value++
}

async function search() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  const id = ++searchId
  loading.value = true
  error.value = ''
  sharedError.value = ''
  stopAllFields()
  searched.value = query.value.trim()
  // The tree lists the open folder's DEs (#1119) when this is a plain folder listing.
  listFolder.value = folder.value && !searched.value ? folder.value.id : null
  local.value = []
  localTotal.value = 0
  localPage.value = 0
  localFetched.value = 0
  localFiltered.value = false
  shared.value = null
  limit.value = DE_PAGE_SIZE
  expanded.value = new Set()
  picked.value = new Set()
  const sharedLoad = wantsShared.value
    ? searchSharedSyncDEs(stack.value, searched.value)
      .then((list) => { if (id === searchId) shared.value = list })
      .catch((e) => { if (id === searchId) { shared.value = []; sharedError.value = e.message } })
    : Promise.resolve().then(() => { if (id === searchId) shared.value = [] })
  try {
    // Shared or Synchronized only: no local pages, wait for the folder walk.
    if (!wantsLocal.value) { await sharedLoad; return }
    await withReconnect(stack.value, () => loadLocalPage(id))
    // A filtered search can match nothing on the first page; read on (20 pages at most).
    for (let n = 1; n < 20 && id === searchId && localFiltered.value && !localDone.value && local.value.length < DE_PAGE_SIZE; n++) await loadLocalPage(id)
  } catch (e) {
    if (id === searchId) error.value = searchError(e, 'search data extensions')
  } finally {
    if (id === searchId) loading.value = false
  }
}

async function loadMore() {
  const id = searchId
  loadingMore.value = true
  try {
    limit.value += DE_PAGE_SIZE
    // A local filter can drop most of a page; read at most 20 pages per click.
    for (let n = 0; n < 20 && id === searchId && !localDone.value && local.value.length < limit.value; n++) await loadLocalPage(id)
  } catch (e) {
    showToast(`Could not load more: ${e.message}`)
  } finally {
    loadingMore.value = false
  }
}

function togglePick(id) {
  const next = new Set(picked.value)
  next.has(id) ? next.delete(id) : next.add(id)
  picked.value = next
}
function togglePickAll() {
  picked.value = allPicked.value ? new Set() : new Set(pickable.value.map((d) => d.id))
}

function refresh() {
  clearDECaches()
  clearSharedDECache(stack.value)
  for (const k of Object.keys(fields)) delete fields[k]
  for (const k of Object.keys(paths)) delete paths[k]
  for (const k of Object.keys(counts)) delete counts[k]
  if (searched.value !== null) search()
}

// ── Fields ───────────────────────────────────────────────
async function loadFields(de) {
  if (fields[de.id]?.status === 'ok' || fields[de.id]?.status === 'loading') return
  fields[de.id] = { status: 'loading' }
  try {
    fields[de.id] = { status: 'ok', list: await fetchDEFieldList(stack.value, de.id) }
  } catch (e) {
    fields[de.id] = { status: 'error', error: e.message }
  }
}

function toggleFields(de) {
  const next = new Set(expanded.value)
  if (next.has(de.id)) next.delete(de.id)
  else { next.add(de.id); loadFields(de) }
  expanded.value = next
}

// View all fields: opens every listed DE, fetching 10 at a time (Automation Viewer).
const allFields = reactive({ running: false, done: 0, total: 0, runId: 0 })
const allShown = computed(() => shown.value.length > 0 && shown.value.every((d) => expanded.value.has(d.id)))

async function viewAllFields() {
  const runId = ++allFields.runId
  const list = shown.value
  expanded.value = new Set(list.map((d) => d.id))
  Object.assign(allFields, { running: true, done: 0, total: list.length })
  await runInBatches(list, 10, (de) => loadFields(de), {
    onProgress: (done) => { if (runId === allFields.runId) allFields.done = done },
    shouldStop: () => runId !== allFields.runId,
  })
  if (runId === allFields.runId) allFields.running = false
}
function stopAllFields() { allFields.runId++; allFields.running = false }
function hideAllFields() { stopAllFields(); expanded.value = new Set() }

// ── Folder paths ─────────────────────────────────────────
async function loadPath(de) {
  if (paths[de.id]?.status === 'ok' || paths[de.id]?.status === 'loading') return
  paths[de.id] = { status: 'loading' }
  try {
    paths[de.id] = { status: 'ok', path: await fetchDEFolderPath(stack.value, de.categoryId) }
  } catch (e) {
    paths[de.id] = { status: 'error', error: e.message }
  }
}
// ── Row counts (feedback #46) ────────────────────────────
async function loadCount(de) {
  if (counts[de.id]?.status === 'ok' || counts[de.id]?.status === 'loading') return
  counts[de.id] = { status: 'loading' }
  try {
    const d = await fetchDEDetail(stack.value, de.id)
    // The list search may leave the description out; the DE's own record has it (#1008).
    if (!de.description && d?.description) de.description = d.description
    counts[de.id] = { status: 'ok', count: deRowCountOf(d) }
  } catch (e) {
    counts[de.id] = { status: 'error', error: e.message }
  }
}
const countsBusy = ref(false)
const batchDone = ref(0) // DEs done by Get all counts / Get all folders (feedback #123)
async function loadAllCounts() {
  countsBusy.value = true
  batchDone.value = 0
  await runInBatches(shown.value, 4, async (de) => { await loadCount(de); batchDone.value++ })
  countsBusy.value = false
}
const countText = (de) => (counts[de.id]?.status === 'ok' ? counts[de.id].count.toLocaleString() : '')

const pathsBusy = ref(false)
async function loadAllPaths() {
  pathsBusy.value = true
  batchDone.value = 0
  await runInBatches(shown.value, 4, async (de) => { await loadPath(de); batchDone.value++ })
  pathsBusy.value = false
}

// ── Build a query from ticked fields ─────────────────────
function isTicked(de, name) { return !!selected.value.get(de.id)?.fields.has(name) }
function tick(de, name) {
  const next = new Map(selected.value)
  const entry = next.get(de.id) || { de, fields: new Set() }
  const f = new Set(entry.fields)
  f.has(name) ? f.delete(name) : f.add(name)
  if (f.size) next.set(de.id, { de, fields: f }); else next.delete(de.id)
  selected.value = next
}
function tickAll(de) {
  const list = fields[de.id]?.list || []
  const next = new Map(selected.value)
  const all = list.length && list.every((f) => isTicked(de, f.name))
  if (all) next.delete(de.id)
  else next.set(de.id, { de, fields: new Set(list.map((f) => f.name)) })
  selected.value = next
}
const selectedSql = computed(() => buildDESelect([...selected.value.values()].map((s) => ({
  de: s.de.name,
  sourceType: s.de.sourceType,
  // Keep the DE's field order, not the order of ticking.
  fields: (fields[s.de.id]?.list || []).map((f) => f.name).filter((n) => s.fields.has(n)),
  allFields: (fields[s.de.id]?.list || []).map((f) => f.name),
}))))
const tickedCount = computed(() => [...selected.value.values()].reduce((n, s) => n + s.fields.size, 0))
async function copySql() {
  await navigator.clipboard.writeText(selectedSql.value)
  showToast('SQL copied.')
}
function openInWorkspace() {
  router.push({ path: '/queries/workspace', query: { sql: selectedSql.value } })
}

// ── Exports ──────────────────────────────────────────────
const exportOpen = ref(false)
const exportKind = ref('names')
const exportPaths = ref(false)
const exporting = reactive({ running: false, done: 0, total: 0 })

async function runExcelExport() {
  exportOpen.value = false
  const list = exportList.value
  Object.assign(exporting, { running: true, done: 0, total: list.length })
  try {
    await runInBatches(list, 10, async (de) => {
      if (exportPaths.value) await loadPath(de)
      if (exportKind.value === 'fields') await loadFields(de)
    }, { onProgress: (d) => { exporting.done = d } })
    const pathOf = (de) => paths[de.id]?.path || ''
    const index = {
      name: exportKind.value === 'fields' ? 'Index' : 'Data Extensions',
      columns: ['DE Name', 'Description', 'Customer Key', 'ID', 'Source', 'Rows', 'Created', 'Modified', ...(exportPaths.value ? ['Path'] : [])],
      rows: list.map((de) => [de.name, de.description || '', de.customerKey, de.id, de.sourceType || 'local', counts[de.id]?.status === 'ok' ? counts[de.id].count : '', de.createdDate || '', de.modifiedDate || '', ...(exportPaths.value ? [pathOf(de)] : [])]),
    }
    const sheets = [index]
    if (exportKind.value === 'fields') {
      for (const de of list) {
        const fl = fields[de.id]?.list
        if (!fl?.length) continue
        sheets.push({
          name: de.name,
          columns: ['Field Name', 'Type', 'Length', 'Scale', 'Primary Key', 'Required', 'Read Only', 'Default Value'],
          rows: fl.map((f) => [f.name, f.type || '', f.length ?? '', f.scale ?? '', f.isPrimaryKey ? 'Yes' : 'No', f.isNullable ? 'No' : 'Yes', f.isReadOnly ? 'Yes' : 'No', f.defaultValue ?? '']),
        })
      }
    }
    await downloadWorkbook(sheets, `${await exportBaseName(stack.value, exportKind.value === 'fields' ? 'data-extensions-fields' : 'data-extensions')}.xlsx`)
  } catch (e) {
    showToast(`Export failed: ${e.message}`)
  } finally {
    exporting.running = false
  }
}

// Download menu: a summary table plus the fields of each DE (fetched for up to 200).
async function buildDoc() {
  const list = exportList.value
  await runInBatches(list.slice(0, 200), 10, (de) => loadFields(de))
  return {
    title: picked.value.size ? `${list.length} data extensions` : searched.value ? `Data extensions matching "${searched.value}"` : 'Data extensions',
    blocks: [
      { type: 'table', columns: ['Name', 'Description', 'Customer Key', 'Source', 'Folder', 'Rows', 'Modified'], rows: list.map((de) => [de.name, de.description || '', de.customerKey, de.sourceType || 'local', paths[de.id]?.path || '', countText(de), formatDateTime(de.modifiedDate)]) },
      ...list.slice(0, 200).flatMap((de) => [
        { type: 'h', level: 2, text: de.name },
        ...(de.description ? [{ type: 'p', text: de.description }] : []),
        fields[de.id]?.status === 'ok'
          ? { type: 'table', columns: ['Field', 'Type', 'Primary key', 'Required'], rows: fields[de.id].list.map((f) => [f.name, fieldTypeLabel(f), f.isPrimaryKey ? 'Yes' : '', f.isNullable ? '' : 'Yes']) }
          : { type: 'p', text: `Fields could not be loaded${fields[de.id]?.error ? `: ${fields[de.id].error}` : '.'}` },
      ]),
      ...(list.length > 200 ? [{ type: 'p', text: `Fields are listed for the first 200 of ${list.length} data extensions.` }] : []),
    ],
  }
}

// ── Detail panel (redesign #1031) ────────────────────────
// Clicking a name opens the DE beside the list: key, ID, folder, rows, dates,
// Query it, Open in SFMC, and tabs for Fields, Preview data and Where used.
const detail = ref(null)
const detailTab = ref('fields')
const DETAIL_TABS = [
  { id: 'fields', label: 'Fields' },
  { id: 'preview', label: 'Preview' },
  { id: 'usage', label: 'Where used' },
]
function openDetail(de) {
  detail.value = de
  detailTab.value = 'fields'
  loadFields(de)
  loadPath(de)
  loadCount(de)
}
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what} copied.`)
  } catch (e) {
    showToast(`Could not copy: ${e.message}`)
  }
}
// SELECT of every field of one DE, for Query it and Copy SELECT.
async function selectAllSql(de) {
  await loadFields(de)
  const list = fields[de.id]?.list
  if (!list?.length) { showToast(fields[de.id]?.error ? `Could not load the fields: ${fields[de.id].error}` : 'This data extension has no fields.'); return '' }
  return buildDESelect([{ de: de.name, sourceType: de.sourceType, fields: list.map((f) => f.name) }])
}
async function queryIt(de) {
  const sql = await selectAllSql(de)
  if (sql) router.push({ path: '/queries/workspace', query: { sql } })
}
async function copySelect(de) {
  const sql = await selectAllSql(de)
  if (sql) copyText(sql, 'SQL')
}
async function loadFoldersAndCounts() {
  await loadAllPaths()
  await loadAllCounts()
}

// ?q= from Ctrl+K or a link (feedback #1098: Where used results open their data extension):
// search, then open the details of the one whose name matches exactly.
useRouteSearch('/data-extensions', (q) => {
  query.value = q
  whenStack(async () => {
    await search()
    const name = String(q).trim().toLowerCase()
    const exact = results.value.filter((d) => String(d.name || '').toLowerCase() === name)
    if (exact.length === 1) openDetail(exact[0])
  })
})

const columns = [
  { key: 'pick', label: '', hideable: false, class: 'w-8' },
  // The customer key shows under the name, so the name filter matches either.
  { key: 'name', label: 'Name', hideable: false, filterValue: (r) => `${r.name} ${r.customerKey || ''}` },
  { key: 'description', label: 'Description', hidden: true }, // #1040: hidden until shown in Columns
  { key: 'path', label: 'Folder', sortValue: (r) => (paths[r.id]?.status === 'ok' ? paths[r.id].path || '(root)' : null) },
  { key: 'rows', label: 'Rows', class: 'text-right whitespace-nowrap', sortValue: (r) => (counts[r.id]?.status === 'ok' ? counts[r.id].count : null) },
  { key: 'modifiedDate', label: 'Modified', class: 'whitespace-nowrap', type: 'date', hidden: true },
  { key: 'createdDate', label: 'Created', class: 'whitespace-nowrap', type: 'date', hidden: true },
  { key: 'id', label: 'ID', hidden: true },
  { key: 'actions', label: '', hideable: false, class: 'text-right' },
]
</script>

<template>
  <div class="h-full flex flex-col bg-background text-foreground">
    <!-- Page header: title, page actions, and the Data Extensions views -->
    <div class="border-b border-border bg-card px-5 pt-3.5 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Database class="h-[18px] w-[18px]" /></span>
          <h1 class="text-[22px] font-bold leading-tight">Data Extensions</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="searched !== null && shown.length">
            <button type="button" class="h-9 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              :disabled="pathsBusy || countsBusy" title="Read the folder path and row count of every data extension shown" @click="loadFoldersAndCounts">
              <Loader2 v-if="pathsBusy || countsBusy" class="h-4 w-4 animate-spin" /><FolderTree v-else class="h-4 w-4" /> Load folders and counts
            </button>
            <button type="button" class="h-9 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              :disabled="exporting.running" @click="exportOpen = true">
              <FileSpreadsheet class="h-4 w-4" /> {{ picked.size ? `Excel (${picked.size})` : 'Excel' }}
            </button>
            <DownloadMenu :get-doc="buildDoc" :file-name="`data-extensions-${searched || 'all'}`" :label="picked.size ? `Download ${picked.size}` : 'Download'" />
          </template>
          <router-link to="/create-de" class="h-9 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus class="h-4 w-4" /> New DE
          </router-link>
        </div>
      </div>
      <nav aria-label="Data extension views" class="flex gap-1 overflow-x-auto whitespace-nowrap">
        <span aria-current="page" class="-mb-px inline-flex h-11 items-center border-b-2 border-primary px-3 text-sm font-semibold">All data extensions</span>
        <router-link to="/de-storage" class="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Storage</router-link>
        <router-link to="/where-used" class="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Where used</router-link>
        <router-link to="/recycle-bin" class="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground" data-recycle-bin-link>Recycle bin</router-link>
      </nav>
    </div>

    <div class="flex-1 min-h-0 flex max-[760px]:flex-col">
      <ContentFolderTree v-model="folder" :stack="stack" :load="folderLoad" cache-kind="des" all-label="All data extensions" :items="results" :items-folder="listFolder" :items-total="total" :item-icon="Database" :active-item="detail?.id" @item="openDetail" class="w-60 shrink-0 border-r border-border max-[760px]:w-full max-[760px]:max-h-48 max-[760px]:border-r-0 max-[760px]:border-b" />
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
          <!-- Search and filters -->
          <div class="flex flex-wrap items-center gap-2.5">
            <form class="flex flex-wrap items-center gap-2.5" @submit.prevent="search">
              <div class="flex h-[38px] w-80 max-w-full items-center gap-2.5 rounded-full border border-border bg-card px-4 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                <Search class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <input v-model="query" type="search" placeholder="Data extension name (empty lists all)" aria-label="Data extension name"
                  class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <button type="submit" class="h-[38px] inline-flex items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60" :disabled="loading">
                <Loader2 v-if="loading" class="h-4 w-4 animate-spin" /> Search
              </button>
            </form>
            <select v-model="sourceFilter" aria-label="Which data extensions" class="h-[38px] rounded-full border border-border bg-card px-3 text-sm">
              <option value="all">All sources</option>
              <option value="local">This BU only</option>
              <option value="shared">Shared only</option>
              <option value="sync">Synchronized only</option>
            </select>
            <button type="button" :aria-pressed="hideSystem" class="h-[34px] inline-flex items-center rounded-full border px-3 text-[13px] font-medium"
              :class="hideSystem ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-accent'" @click="hideSystem = !hideSystem">Hide system DEs</button>
            <button type="button" :aria-pressed="hideQueryStudio" title="Hide the QueryStudioResults data extensions that Query Studio creates for each run"
              class="h-[34px] inline-flex items-center rounded-full border px-3 text-[13px] font-medium"
              :class="hideQueryStudio ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-accent'" @click="hideQueryStudio = !hideQueryStudio">Hide QueryStudioResults</button>
            <span class="ml-auto flex items-center gap-2">
              <template v-if="searched !== null && shown.length">
                <button v-if="!allShown && !allFields.running" type="button" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-accent" @click="viewAllFields"><ListTree class="h-4 w-4" /> View all fields</button>
                <button v-else type="button" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-accent" @click="hideAllFields"><ListTree class="h-4 w-4" /> Hide all fields</button>
              </template>
              <button type="button" aria-label="Refresh" title="Refresh: forget cached fields, folders and the Shared/Synchronized list"
                class="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-card hover:bg-accent" @click="refresh"><RefreshCw class="h-4 w-4" /></button>
            </span>
          </div>

          <div v-if="countsBusy || pathsBusy" class="rounded-xl border border-border bg-card px-3 py-2">
            <ProgressBar :value="batchDone" :max="shown.length" :label="countsBusy ? 'Reading row counts' : 'Reading folders'" show-count />
          </div>
          <div v-if="allFields.running || exporting.running" class="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground flex items-center gap-3">
            <span>{{ exporting.running ? 'Preparing the export' : 'Loading fields' }} {{ exporting.running ? exporting.done : allFields.done }} of {{ exporting.running ? exporting.total : allFields.total }}</span>
            <ProgressBar :value="exporting.running ? exporting.done : allFields.done" :max="exporting.running ? exporting.total : allFields.total" aria-label="Progress" class="flex-1" />
            <button v-if="allFields.running" class="underline" @click="stopAllFields">Stop</button>
          </div>

          <SfmcErrorNotice :error="error" :retrying="loading" @retry="search" />
          <div v-if="searched === null && !loading" class="mx-auto mt-10 max-w-md rounded-[14px] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Search for a data extension by name. Shared and Synchronized data extensions are included and tagged.
            Search with an empty box to list all, newest first.
          </div>
          <template v-else-if="searched !== null">
            <div class="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
              <span><span class="font-bold text-foreground">{{ total.toLocaleString() }}{{ totalIsPartial ? '+' : '' }}</span> found{{ searched ? ` for "${searched}"` : '' }}, {{ shown.length }} shown<template v-if="shown.length !== results.length"> ({{ results.length - shown.length }} hidden by the filters)</template></span>
              <span v-if="shared === null" class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Adding Shared and Synchronized data extensions</span>
              <span v-else-if="sharedError" class="text-amber-700 dark:text-amber-400">Shared and Synchronized data extensions could not be loaded ({{ sharedError }}).</span>
              <span v-if="picked.size">{{ picked.size }} ticked for download. <button class="text-primary hover:underline" @click="picked = new Set()">Clear</button></span>
            </div>
            <div class="[&>div]:rounded-[14px]">
              <DataTable :columns="columns" :rows="shown" row-key="id" storage-key="data-extensions-2" :expanded="expanded" :row-class="(r) => (detail?.id === r.id ? 'bg-primary/5' : '')" empty-text="No data extensions found." @shown="filtered = $event">
                <template #head-pick>
                  <input type="checkbox" :checked="allPicked" :indeterminate="picked.size > 0 && !allPicked" aria-label="Tick every data extension shown" @change="togglePickAll" />
                </template>
                <template #cell-pick="{ row }">
                  <input type="checkbox" :checked="picked.has(row.id)" :aria-label="`Tick ${row.name} for download`" @change="togglePick(row.id)" />
                </template>
                <template #cell-name="{ row }">
                  <button type="button" class="flex flex-col gap-0.5 text-left" :aria-current="detail?.id === row.id ? 'true' : undefined" title="Open the details" @click="openDetail(row)">
                    <span class="flex flex-wrap items-center gap-1.5">
                      <span class="text-sm font-semibold hover:underline" :class="detail?.id === row.id ? 'text-primary' : 'text-[#1557B0] dark:text-sky-400'">{{ row.name }}</span>
                      <span v-if="row.sourceType" class="text-[10px] font-semibold rounded-full px-1.5 py-px"
                        :class="row.sourceType === 'shared' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' : 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'">
                        {{ row.sourceType === 'shared' ? 'Shared' : 'Synchronized' }}
                      </span>
                    </span>
                    <code v-if="row.customerKey" class="font-mono text-[11px] text-muted-foreground break-all">{{ row.customerKey }}</code>
                  </button>
                </template>
                <template #cell-description="{ row }">
                  <span v-if="row.description" class="block max-w-xs truncate text-muted-foreground" :title="row.description">{{ row.description }}</span>
                </template>
                <template #cell-path="{ row }">
                  <span v-if="paths[row.id]?.status === 'ok'" class="text-[13px]">{{ paths[row.id].path || '(root)' }}</span>
                  <Loader2 v-else-if="paths[row.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span v-else-if="paths[row.id]?.status === 'error'" class="text-red-600 dark:text-red-400" :title="paths[row.id].error">Could not load</span>
                  <button v-else class="text-primary hover:underline" @click="loadPath(row)">Get folder</button>
                </template>
                <template #cell-rows="{ row }">
                  <span v-if="counts[row.id]?.status === 'ok'" class="text-[13px] font-semibold tabular-nums">{{ counts[row.id].count.toLocaleString() }}</span>
                  <Loader2 v-else-if="counts[row.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                  <span v-else-if="counts[row.id]?.status === 'error'" class="text-red-600 dark:text-red-400" :title="counts[row.id].error">Could not load</span>
                  <button v-else class="text-primary hover:underline" @click="loadCount(row)">Get count</button>
                </template>
                <template #cell-modifiedDate="{ row }"><span class="text-[13px]">{{ formatDateTime(row.modifiedDate) }}</span></template>
                <template #cell-createdDate="{ row }"><span class="text-[13px] text-muted-foreground">{{ formatDateTime(row.createdDate) }}</span></template>
                <template #cell-id="{ row }"><code class="font-mono text-[11px]">{{ row.id }}</code></template>
                <template #cell-actions="{ row }">
                  <a :href="deContactBuilderUrl(stack, row)" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap mr-3"
                    :title="row.sourceType ? 'Open in Contact Builder (from the business unit that owns it)' : 'Open in Contact Builder'">SFMC <ExternalLink class="h-3 w-3" /></a>
                  <RouterLink :to="previewTo(row)" class="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap mr-3" title="Preview this data extension's rows (no query is run). Ctrl or middle click opens a new tab.">
                    <Rows3 class="h-3.5 w-3.5" /> Preview data
                  </RouterLink>
                  <button class="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap mr-3" title="Query activities and automations that use this data extension" @click="whereUsed(row)">
                    <Network class="h-3.5 w-3.5" /> Where used
                  </button>
                  <button class="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap" :aria-expanded="expanded.has(row.id)" @click="toggleFields(row)">
                    <ChevronDown v-if="expanded.has(row.id)" class="h-3.5 w-3.5" /><ChevronRight v-else class="h-3.5 w-3.5" /> Fields
                  </button>
                </template>
                <template #expanded="{ row }">
                  <div v-if="fields[row.id]?.status === 'loading'" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading fields…</div>
                  <p v-else-if="fields[row.id]?.status === 'error'" class="text-red-600 dark:text-red-400">Could not load the fields: {{ fields[row.id].error }}<ReportErrorButton /></p>
                  <div v-else-if="fields[row.id]?.status === 'ok'">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="font-semibold">{{ fields[row.id].list.length }} {{ fields[row.id].list.length === 1 ? 'field' : 'fields' }}</span>
                      <RouterLink :to="previewTo(row)" class="inline-flex items-center gap-1 text-primary hover:underline"><Rows3 class="h-3.5 w-3.5" /> Preview data</RouterLink>
                      <button v-if="REORDER_ENABLED && !row.sourceType" class="inline-flex items-center gap-1 text-primary hover:underline" title="Change the order of this data extension's columns" @click="reorderDE = row"><ArrowUpDown class="h-3.5 w-3.5" /> Reorder columns</button>
                      <button class="text-primary hover:underline" @click="tickAll(row)">
                        {{ fields[row.id].list.length && fields[row.id].list.every((f) => isTicked(row, f.name)) ? 'Untick all' : 'Tick all for a query' }}
                      </button>
                    </div>
                    <table class="w-full max-w-3xl">
                      <thead><tr class="text-left text-muted-foreground"><th class="w-6"></th><th class="py-1 pr-3">Field</th><th class="pr-3">Type</th><th class="pr-3">Primary key</th><th class="pr-3">Required</th><th>Default</th><th></th></tr></thead>
                      <tbody>
                        <tr v-for="f in fields[row.id].list" :key="f.name" class="border-t border-border/60">
                          <td><input type="checkbox" :checked="isTicked(row, f.name)" :aria-label="`Use ${f.name} in a query`" @change="tick(row, f.name)" /></td>
                          <td class="py-1 pr-3" :class="{ 'font-semibold': f.isPrimaryKey }">{{ f.name }}</td>
                          <td class="pr-3">{{ fieldTypeLabel(f) }}</td>
                          <td class="pr-3">{{ f.isPrimaryKey ? 'Yes' : '' }}</td>
                          <td class="pr-3">{{ f.isNullable ? '' : 'Yes' }}</td>
                          <td class="text-muted-foreground">{{ f.defaultValue ?? '' }}</td>
                          <td class="pl-3 text-right"><button class="inline-flex items-center gap-0.5 text-primary hover:underline whitespace-nowrap" :title="`Where is ${f.name} used?`" @click="whereFieldUsed(row, f.name)"><Network class="h-3 w-3" /> Where used</button></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>
              </DataTable>
            </div>
            <div v-if="canLoadMore" class="text-center">
              <button type="button" class="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-accent disabled:opacity-50" :disabled="loadingMore" @click="loadMore">
                <Loader2 v-if="loadingMore" class="h-3.5 w-3.5 animate-spin" /> Load {{ DE_PAGE_SIZE }} more
              </button>
            </div>
          </template>
        </div>

        <!-- Query from ticked fields -->
        <div v-if="tickedCount" class="border-t border-border bg-card px-5 py-2.5">
          <div class="flex items-center gap-2 mb-1.5 text-xs">
            <span class="text-sm font-semibold">Query from {{ tickedCount }} ticked {{ tickedCount === 1 ? 'field' : 'fields' }}</span>
            <div class="flex-1" />
            <button type="button" class="h-8 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90" @click="openInWorkspace"><Play class="h-3.5 w-3.5" /> Run this query</button>
            <button type="button" class="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-accent" @click="copySql"><Copy class="h-3.5 w-3.5" /> Copy</button>
            <button type="button" class="h-8 inline-flex items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-accent" @click="selected = new Map()"><X class="h-3.5 w-3.5" /> Clear</button>
          </div>
          <pre class="max-h-40 overflow-auto rounded-lg bg-slate-900 text-slate-100 p-2 font-mono text-[11px]">{{ selectedSql }}</pre>
        </div>
      </div>

      <!-- Detail panel -->
      <aside v-if="detail" aria-label="Data extension details" class="w-[420px] max-w-[45%] shrink-0 border-l border-border bg-card flex flex-col min-h-0">
        <div class="flex flex-col gap-3 border-b border-border px-5 py-4">
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex min-w-0 items-start gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Database class="h-[18px] w-[18px]" /></span>
              <div class="min-w-0">
                <h2 class="text-[17px] font-bold break-words">{{ detail.name }}</h2>
                <span v-if="detail.sourceType" class="text-[10px] font-semibold rounded-full px-1.5 py-px"
                  :class="detail.sourceType === 'shared' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' : 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'">
                  {{ detail.sourceType === 'shared' ? 'Shared' : 'Synchronized' }}
                </span>
              </div>
            </div>
            <button type="button" aria-label="Close" class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-border bg-card hover:bg-accent" @click="detail = null"><X class="h-4 w-4" /></button>
          </div>
          <p v-if="detail.description" class="text-[13px] text-muted-foreground">{{ detail.description }}</p>
          <dl class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt class="text-muted-foreground">Customer key</dt>
            <dd class="flex min-w-0 items-center gap-1.5">
              <code class="font-mono text-[11px] break-all">{{ detail.customerKey }}</code>
              <button v-if="detail.customerKey" type="button" aria-label="Copy customer key" class="p-0.5 text-muted-foreground hover:text-foreground" @click="copyText(detail.customerKey, 'Customer key')"><Copy class="h-3.5 w-3.5" /></button>
            </dd>
            <dt class="text-muted-foreground">ID</dt>
            <dd class="flex min-w-0 items-center gap-1.5">
              <code class="font-mono text-[11px] break-all">{{ detail.id }}</code>
              <button type="button" aria-label="Copy ID" class="p-0.5 text-muted-foreground hover:text-foreground" @click="copyText(detail.id, 'ID')"><Copy class="h-3.5 w-3.5" /></button>
            </dd>
            <dt class="text-muted-foreground">Folder</dt>
            <dd class="min-w-0 break-words">
              <span v-if="paths[detail.id]?.status === 'ok'">{{ paths[detail.id].path || '(root)' }}</span>
              <Loader2 v-else-if="paths[detail.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span v-else-if="paths[detail.id]?.status === 'error'" class="text-red-600 dark:text-red-400" :title="paths[detail.id].error">Could not load</span>
            </dd>
            <dt class="text-muted-foreground">Rows</dt>
            <dd>
              <span v-if="counts[detail.id]?.status === 'ok'" class="font-semibold tabular-nums">{{ counts[detail.id].count.toLocaleString() }}</span>
              <Loader2 v-else-if="counts[detail.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span v-else-if="counts[detail.id]?.status === 'error'" class="text-red-600 dark:text-red-400" :title="counts[detail.id].error">Could not load</span>
            </dd>
            <dt class="text-muted-foreground">Modified</dt>
            <dd>{{ formatDateTime(detail.modifiedDate) }}</dd>
            <dt class="text-muted-foreground">Created</dt>
            <dd>{{ formatDateTime(detail.createdDate) }}</dd>
          </dl>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="h-[34px] inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90" title="Open a SELECT of every field in Run Query" @click="queryIt(detail)"><Play class="h-3.5 w-3.5" /> Query it</button>
            <button type="button" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium hover:bg-accent" @click="copySelect(detail)"><Copy class="h-3.5 w-3.5" /> Copy SELECT</button>
            <a :href="deContactBuilderUrl(stack, detail)" target="_blank" rel="noopener" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium hover:bg-accent"
              :title="detail.sourceType ? 'Open in Contact Builder (from the business unit that owns it)' : 'Open in Contact Builder'">Open in SFMC <ExternalLink class="h-3.5 w-3.5" /></a>
          </div>
        </div>
        <nav aria-label="Details" class="flex gap-1 border-b border-border px-3">
          <button v-for="t in DETAIL_TABS" :key="t.id" type="button" :aria-current="detailTab === t.id ? 'page' : undefined"
            class="-mb-px h-[42px] border-b-2 px-2.5 text-[13px]"
            :class="detailTab === t.id ? 'border-primary font-semibold text-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground'"
            @click="detailTab = t.id">{{ t.label }}</button>
        </nav>
        <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 text-[13px]">
          <template v-if="detailTab === 'fields'">
            <div v-if="fields[detail.id]?.status === 'loading'" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading fields…</div>
            <p v-else-if="fields[detail.id]?.status === 'error'" class="text-red-600 dark:text-red-400">Could not load the fields: {{ fields[detail.id].error }}<ReportErrorButton /></p>
            <div v-else-if="fields[detail.id]?.status === 'ok'" class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="font-semibold">{{ fields[detail.id].list.length }} {{ fields[detail.id].list.length === 1 ? 'field' : 'fields' }}</span>
                <button v-if="REORDER_ENABLED && !detail.sourceType" class="inline-flex items-center gap-1 text-primary hover:underline" title="Change the order of this data extension's columns" @click="reorderDE = detail"><ArrowUpDown class="h-3.5 w-3.5" /> Reorder columns</button>
                <button class="text-primary hover:underline" @click="tickAll(detail)">
                  {{ fields[detail.id].list.length && fields[detail.id].list.every((f) => isTicked(detail, f.name)) ? 'Untick all' : 'Tick all for a query' }}
                </button>
              </div>
              <ul class="divide-y divide-border rounded-xl border border-border">
                <li v-for="f in fields[detail.id].list" :key="f.name" class="flex items-center gap-2.5 px-3 py-2">
                  <input type="checkbox" :checked="isTicked(detail, f.name)" :aria-label="`Use ${f.name} in a query`" @change="tick(detail, f.name)" />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <KeyRound v-if="f.isPrimaryKey" class="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Primary key" />
                      <span class="break-all" :class="{ 'font-semibold': f.isPrimaryKey }">{{ f.name }}</span>
                    </span>
                    <span class="block text-[11px] text-muted-foreground">
                      {{ fieldTypeLabel(f) }}<template v-if="!f.isNullable"> · Required</template><template v-if="f.defaultValue != null && f.defaultValue !== ''"> · Default {{ f.defaultValue }}</template>
                    </span>
                  </span>
                  <button type="button" class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" :title="`Where is ${f.name} used?`" :aria-label="`Where is ${f.name} used?`" @click="whereFieldUsed(detail, f.name)"><Network class="h-3.5 w-3.5" /></button>
                </li>
              </ul>
              <p class="text-[12px] text-muted-foreground">Ticked fields build a query at the bottom of the list.</p>
            </div>
          </template>
          <div v-else-if="detailTab === 'preview'" class="flex flex-col items-start gap-3">
            <p class="text-muted-foreground">Read this data extension's rows, 50 at a time. No query is run.</p>
            <RouterLink :to="previewTo(detail)" class="h-[34px] inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90"><Rows3 class="h-3.5 w-3.5" /> Preview data</RouterLink>
          </div>
          <div v-else class="flex flex-col items-start gap-3">
            <p class="text-muted-foreground">Find the queries, automations, journeys and content that use this data extension.</p>
            <button type="button" class="h-[34px] inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90" @click="whereUsed(detail)"><Network class="h-3.5 w-3.5" /> Find where it is used</button>
          </div>
        </div>
      </aside>
    </div>

    <ReorderFieldsDialog v-if="reorderDE" :key="reorderDE.id" :stack="stack" :de="reorderDE" @changed="afterReorder(reorderDE)" @close="reorderDE = null" />

    <!-- Excel export -->
    <div v-if="exportOpen" class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="exportOpen = false">
      <div class="w-full max-w-sm rounded-[14px] border border-border bg-card p-5 shadow-xl text-sm" role="dialog" aria-modal="true" aria-labelledby="de-export-title">
        <h2 id="de-export-title" class="text-base font-semibold mb-3">Export {{ exportList.length }} {{ picked.size ? 'ticked' : '' }} data extensions to Excel</h2>
        <label class="flex items-start gap-2 mb-2"><input v-model="exportKind" type="radio" value="names" class="mt-1" /><span>Names only<br /><span class="text-xs text-muted-foreground">One sheet: name, customer key, ID, source, dates.</span></span></label>
        <label class="flex items-start gap-2 mb-3"><input v-model="exportKind" type="radio" value="fields" class="mt-1" /><span>All fields<br /><span class="text-xs text-muted-foreground">An index sheet plus one sheet of fields per data extension.</span></span></label>
        <label class="flex items-center gap-2 mb-4"><input v-model="exportPaths" type="checkbox" /> Include folder paths</label>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" class="h-8 rounded-full text-xs" @click="exportOpen = false">Cancel</Button>
          <Button size="sm" class="h-8 rounded-full text-xs" @click="runExcelExport">Export</Button>
        </div>
      </div>
    </div>
  </div>
</template>
