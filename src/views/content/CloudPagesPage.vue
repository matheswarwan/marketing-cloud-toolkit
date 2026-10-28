<script setup>
// CloudPages (SFMC Automation Viewer's CloudPage Finder): search CloudPage assets,
// get each page's public URL and folder (one or all), export to Excel or a document.
import { computed, reactive, ref } from 'vue'
import { Search, Loader2, Link2, FolderTree, FileSpreadsheet, RefreshCw, ExternalLink, Code2 } from 'lucide-vue-next'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import CloudPageSourceDialog from '@/components/content/CloudPageSourceDialog.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useStack, whenStack } from '@/composables/useStack.js'
import { exportBaseName } from '@/utils/exportName.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { showToast } from '@/composables/useToast.js'
import { searchCloudPages, resolveCloudPageUrl, fetchCloudPageFolderPath, clearCloudPageCaches, isSystemCloudPage, CP_PAGE_SIZE } from '@/utils/cloudPagesApi.js'
import { runInBatches } from '@/utils/batchRunner.js'
import { downloadWorkbook } from '@/utils/exportDoc.js'
import { formatDateTime, formatDate } from '@/utils/format.js'

const { stack } = useStack()
const query = ref('')
const searched = ref(null)
const pages = ref([])
const total = ref(0)
const pageNo = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const hideUnpublished = ref(false)
const hideSystem = ref(false)
const urls = reactive({}) // id → { status, url }
const paths = reactive({}) // id → { status, path }
const busy = reactive({ urls: false, paths: false })
// The page whose preview and source are open (feedback #1010).
const viewing = ref(null)

const shown = computed(() => pages.value.filter((p) => (!hideUnpublished.value || p.status === 'Published') && (!hideSystem.value || !isSystemCloudPage(p.name))))

async function search() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  loading.value = true
  error.value = ''
  try {
    const r = await withReconnect(stack.value, () => searchCloudPages(stack.value, query.value, 1))
    pages.value = r.items
    total.value = r.total
    pageNo.value = 1
    searched.value = query.value.trim()
    for (const p of r.items) if (p.url) urls[p.id] = { status: 'ok', url: p.url }
  } catch (e) {
    error.value = searchError(e, 'search CloudPages')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const r = await searchCloudPages(stack.value, searched.value, pageNo.value + 1)
    pages.value = [...pages.value, ...r.items]
    pageNo.value++
    for (const p of r.items) if (p.url) urls[p.id] = { status: 'ok', url: p.url }
  } catch (e) {
    showToast(`Could not load more: ${e.message}`)
  } finally {
    loadingMore.value = false
  }
}

async function loadUrl(p) {
  if (urls[p.id]?.status === 'ok' || urls[p.id]?.status === 'loading') return
  urls[p.id] = { status: 'loading' }
  const url = await resolveCloudPageUrl(stack.value, p)
  urls[p.id] = { status: 'ok', url }
}
async function loadPath(p) {
  if (paths[p.id]?.status === 'ok' || paths[p.id]?.status === 'loading') return
  paths[p.id] = { status: 'loading' }
  try { paths[p.id] = { status: 'ok', path: await fetchCloudPageFolderPath(stack.value, p.categoryId) } } catch (e) { paths[p.id] = { status: 'error', error: e.message } }
}
async function loadAll(kind) {
  busy[kind] = true
  await runInBatches(shown.value, 4, kind === 'urls' ? loadUrl : loadPath)
  busy[kind] = false
}

function refresh() {
  clearCloudPageCaches()
  for (const k of Object.keys(paths)) delete paths[k]
  for (const k of Object.keys(urls)) delete urls[k]
  if (searched.value !== null) search()
}

const exportOpen = ref(false)
const exportPaths = ref(false)
const exporting = ref(false)
async function runExport() {
  exportOpen.value = false
  exporting.value = true
  try {
    if (exportPaths.value) await runInBatches(shown.value, 4, loadPath)
    await downloadWorkbook([{
      name: 'CloudPages',
      columns: ['Name', 'Key', 'Type', 'Status', 'Asset ID', 'URL', 'Created', 'Modified', ...(exportPaths.value ? ['Path'] : [])],
      rows: shown.value.map((p) => [p.name, p.customerKey, p.assetType, p.status, p.id, urls[p.id]?.url || '', formatDate(p.createdDate), formatDate(p.modifiedDate), ...(exportPaths.value ? [paths[p.id]?.path || ''] : [])]),
    }], `${await exportBaseName(stack.value, `cloudpages-${searched.value || 'all'}`)}.xlsx`)
  } catch (e) {
    showToast(`Export failed: ${e.message}`)
  } finally {
    exporting.value = false
  }
}

function getDoc() {
  return {
    title: searched.value ? `CloudPages matching "${searched.value}"` : 'CloudPages',
    blocks: [{ type: 'table', columns: ['Name', 'Key', 'Type', 'Status', 'Asset ID', 'URL', 'Folder', 'Modified'],
      rows: shown.value.map((p) => [p.name, p.customerKey, p.assetType, p.status, p.id, urls[p.id]?.url || '', paths[p.id]?.path || p.categoryName, formatDateTime(p.modifiedDate)]) }],
  }
}

useRouteSearch('/cloudpages', (q) => { query.value = q; whenStack(search) })

const columns = [
  { key: 'name', label: 'Name', hideable: false },
  { key: 'customerKey', label: 'Key' },
  { key: 'assetType', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'id', label: 'Asset ID' },
  { key: 'categoryName', label: 'Category' },
  { key: 'url', label: 'URL', sortValue: (r) => urls[r.id]?.url || null },
  { key: 'path', label: 'Folder path', sortValue: (r) => (paths[r.id]?.status === 'ok' ? paths[r.id].path : null) },
  { key: 'modifiedDate', label: 'Modified', class: 'whitespace-nowrap', type: 'date' },
]
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <form class="flex items-center gap-2" @submit.prevent="search">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="query" type="search" placeholder="Name, content or key (empty lists all)" aria-label="CloudPage search"
            class="h-8 w-72 rounded-md border border-border bg-background pl-7 pr-2 text-xs" />
        </div>
        <Button size="sm" class="h-8 text-xs" type="submit" :disabled="loading"><Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /> Search</Button>
      </form>
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground"><input v-model="hideUnpublished" type="checkbox" /> Hide unpublished</label>
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground"><input v-model="hideSystem" type="checkbox" /> Hide system pages</label>
      <div class="flex-1" />
      <template v-if="searched !== null && shown.length">
        <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy.urls" @click="loadAll('urls')"><Loader2 v-if="busy.urls" class="h-3.5 w-3.5 mr-1 animate-spin" /><Link2 v-else class="h-3.5 w-3.5 mr-1" /> Get all URLs</Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy.paths" @click="loadAll('paths')"><Loader2 v-if="busy.paths" class="h-3.5 w-3.5 mr-1 animate-spin" /><FolderTree v-else class="h-3.5 w-3.5 mr-1" /> Get all folders</Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="exporting" @click="exportOpen = true"><Loader2 v-if="exporting" class="h-3.5 w-3.5 mr-1 animate-spin" /><FileSpreadsheet v-else class="h-3.5 w-3.5 mr-1" /> Excel</Button>
        <DownloadMenu :get-doc="getDoc" :file-name="`cloudpages-${searched || 'all'}`" />
      </template>
      <Button variant="ghost" size="icon" class="h-8 w-8" title="Refresh: forget cached URLs and folders" @click="refresh"><RefreshCw class="h-4 w-4" /></Button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <SfmcErrorNotice :error="error" :retrying="loading" @retry="search" />
      <div v-if="searched === null && !loading" class="max-w-md mx-auto mt-12 text-center text-sm text-muted-foreground">
        Search CloudPages by name, content or key, or search with an empty box to list all.
      </div>
      <template v-else-if="searched !== null">
        <p class="mb-2 text-xs text-muted-foreground">{{ total.toLocaleString() }} found{{ searched ? ` for "${searched}"` : '' }}, {{ shown.length }} shown.</p>
        <DataTable :columns="columns" :rows="shown" row-key="id" storage-key="cloudpages" empty-text="No CloudPages found.">
          <template #cell-name="{ row }">
            <span class="font-medium">{{ row.name }}</span>
            <button class="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline text-[11px]" title="Preview and source" @click="viewing = row"><Code2 class="h-3 w-3" /> View</button>
          </template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          <template #cell-url="{ row }">
            <a v-if="urls[row.id]?.url" :href="urls[row.id].url" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary hover:underline break-all">{{ urls[row.id].url }} <ExternalLink class="h-3 w-3 shrink-0" /></a>
            <Loader2 v-else-if="urls[row.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span v-else-if="urls[row.id]?.status === 'ok'" class="text-muted-foreground">{{ row.status === 'Published' ? 'Not found' : 'No public URL' }}</span>
            <button v-else class="text-primary hover:underline" @click="loadUrl(row)">Get URL</button>
          </template>
          <template #cell-path="{ row }">
            <span v-if="paths[row.id]?.status === 'ok'">{{ paths[row.id].path }}</span>
            <Loader2 v-else-if="paths[row.id]?.status === 'loading'" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span v-else-if="paths[row.id]?.status === 'error'" class="text-red-600" :title="paths[row.id].error">Could not load</span>
            <button v-else class="text-primary hover:underline" @click="loadPath(row)">Get folder</button>
          </template>
          <template #cell-modifiedDate="{ row }">{{ formatDateTime(row.modifiedDate) }}</template>
        </DataTable>
        <div v-if="pageNo * CP_PAGE_SIZE < total" class="mt-3 text-center">
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loadingMore" @click="loadMore"><Loader2 v-if="loadingMore" class="h-3.5 w-3.5 mr-1 animate-spin" /> Load {{ Math.min(50, total - pages.length) }} more ({{ pages.length }} of {{ total }})</Button>
        </div>
      </template>
    </div>

    <CloudPageSourceDialog :page="viewing" :stack="stack" @close="viewing = null" />

    <div v-if="exportOpen" class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="exportOpen = false">
      <div class="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl text-sm" role="dialog" aria-modal="true" aria-labelledby="cp-export-title">
        <h2 id="cp-export-title" class="font-semibold mb-2">Export {{ shown.length }} CloudPages to Excel</h2>
        <p class="text-xs text-muted-foreground mb-3">Name, key, type, status, asset ID, URL (when looked up), created and modified dates.</p>
        <label class="flex items-center gap-2 mb-4"><input v-model="exportPaths" type="checkbox" /> Include folder paths</label>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" class="h-8 text-xs" @click="exportOpen = false">Cancel</Button>
          <Button size="sm" class="h-8 text-xs" @click="runExport">Export</Button>
        </div>
      </div>
    </div>
  </div>
</template>
