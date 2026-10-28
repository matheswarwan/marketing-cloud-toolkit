<script setup>
// DE storage fallback (feedback #68), used when SFMC's storage calls fail: every DE
// in the business unit with its row count, largest first, and totals per folder.
// Kept per stack and BU while the tab is open (utils/pageCache.js).
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, ref } from 'vue'
import { Loader2, Play, Square, FolderTree, Download } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import { fetchDEFolderPath, isSystemDE, DE_PAGE_SIZE } from '@/utils/deApi.js'
import { listAllDEs, readRowCounts, sortBySize, summarizeStorage, groupByFolder, storageCsv, sourceLabel, MAX_DES } from '@/utils/deStorage.js'
import { runInBatches } from '@/utils/batchRunner.js'
import { pageCacheKey, readPageCache, writePageCache } from '@/utils/pageCache.js'
import { saveTextFile } from '@/utils/download.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const rows = ref([]) // DEs with rows / rowError
const paths = ref({}) // categoryId → folder path
const phase = ref('idle') // idle | listing | counting | folders
const progress = ref({ done: 0, total: 0 })
const error = ref('')
const capped = ref(false)
const savedAt = ref(0)
let stop = false
let cacheKey = ''

const hideSystem = ref(false)
const filter = ref('')
const view = ref('des') // des | folders
const limit = ref(DE_PAGE_SIZE)

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return sortBySize(rows.value.filter((r) => (!hideSystem.value || !isSystemDE(r.name)) && (!q || r.name.toLowerCase().includes(q))))
})
const shown = computed(() => visible.value.slice(0, limit.value))
const summary = computed(() => (rows.value.length ? summarizeStorage(visible.value) : null))
const folders = computed(() => groupByFolder(visible.value, paths.value))
const hasPaths = computed(() => Object.keys(paths.value).length > 0)
const busy = computed(() => phase.value !== 'idle')

async function currentKey() {
  const bu = await fetchCurrentBU(stack.value).catch(() => null)
  return pageCacheKey('de-storage-counts', stack.value, bu?.accountId)
}
const save = () => { if (cacheKey) savedAt.value = writePageCache(cacheKey, { rows: rows.value, paths: paths.value, capped: capped.value }).savedAt }

async function start() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud.'; return }
  stop = false
  error.value = ''
  rows.value = []
  paths.value = {}
  limit.value = DE_PAGE_SIZE
  try {
    cacheKey = await currentKey()
    phase.value = 'listing'
    const list = await listAllDEs(stack.value, { onProgress: (done, total) => { progress.value = { done, total } }, shouldStop: () => stop })
    capped.value = list.capped
    rows.value = list.items.map((d) => ({ ...d, rows: null, rowError: '' }))
    phase.value = 'counting'
    progress.value = { done: 0, total: rows.value.length }
    const byId = new Map(rows.value.map((r, i) => [r.id, i]))
    const errors = await readRowCounts(stack.value, rows.value, {
      onRow: (de, count, err) => { const r = rows.value[byId.get(de.id)]; r.rows = count; r.rowError = err || '' },
      onProgress: (done, total) => { progress.value = { done, total } },
      shouldStop: () => stop,
    })
    if (errors) error.value = `${errors} row counts could not be read.`
  } catch (e) {
    error.value = `Could not read the data extensions: ${e.message}`
  } finally {
    phase.value = 'idle'
    save()
  }
}

async function loadFolders() {
  stop = false
  phase.value = 'folders'
  const ids = [...new Set(rows.value.map((r) => r.categoryId).filter((id) => id != null && !(id in paths.value)))]
  progress.value = { done: 0, total: ids.length }
  const found = { ...paths.value }
  await runInBatches(ids, 5, async (id) => { found[id] = await fetchDEFolderPath(stack.value, id).catch(() => `Folder ${id}`) }, {
    onProgress: (done, total) => { progress.value = { done, total } },
    shouldStop: () => stop,
  })
  paths.value = found
  phase.value = 'idle'
  view.value = 'folders'
  save()
}

function downloadCsv() {
  saveTextFile(storageCsv(visible.value, paths.value), `de-storage-${stack.value || 'sfmc'}.csv`, 'text/csv', 'CSV file')
}

const PHASE = { listing: 'Listing data extensions', counting: 'Reading row counts', folders: 'Reading folders' }
const fmtRows = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
const share = (n) => (summary.value?.totalRows ? `${((100 * (n || 0)) / summary.value.totalRows).toFixed(1)}%` : '')

whenStack(async () => {
  if (!stack.value) return
  cacheKey = await currentKey()
  const saved = readPageCache(cacheKey)
  if (saved?.rows) { rows.value = saved.rows; paths.value = saved.paths || {}; capped.value = !!saved.capped; savedAt.value = saved.savedAt }
})
</script>

<template>
  <div class="space-y-4 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold flex-1">Row counts instead</h2>
      <ProgressBar v-if="busy" :value="progress.done" :max="progress.total" :label="PHASE[phase]" show-count class="w-72" />
      <span v-else-if="savedAt" class="text-xs text-muted-foreground">Read {{ formatDateTime(new Date(savedAt).toISOString()) }}</span>
      <Button v-if="busy" variant="outline" size="sm" class="h-8 text-xs" @click="stop = true"><Square class="h-3.5 w-3.5 mr-1" /> Stop</Button>
      <Button v-else size="sm" class="h-8 text-xs" @click="start"><Play class="h-3.5 w-3.5 mr-1" /> {{ rows.length ? 'Read again' : 'Read row counts' }}</Button>
    </div>
    <p v-if="!rows.length && !busy" class="text-xs text-muted-foreground">Lists every data extension in this business unit (up to {{ MAX_DES.toLocaleString() }}, plus Shared and Synchronized ones) and reads each one's row count, 10 at a time, then shows the largest first. SFMC does not report storage in bytes through these APIs, so rows are the measure; an upper bound on size can be estimated from the fields.</p>
    <p v-if="error" class="text-red-600 text-xs" role="alert">{{ error }}</p>
    <p v-if="capped" class="text-xs text-amber-700 dark:text-amber-400">Only the {{ MAX_DES.toLocaleString() }} most recently changed local data extensions were read.</p>

    <template v-if="summary">
      <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Data extensions</div><div class="text-2xl font-semibold tabular-nums">{{ summary.des.toLocaleString() }}</div><div class="text-xs text-muted-foreground">{{ summary.empty.toLocaleString() }} empty</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Rows in all</div><div class="text-2xl font-semibold tabular-nums">{{ summary.totalRows.toLocaleString() }}</div><div class="text-xs text-muted-foreground">{{ summary.counted.toLocaleString() }} counted</div></div>
        <div class="rounded-lg border border-border bg-card p-3 col-span-2">
          <div class="text-xs text-muted-foreground">Largest</div>
          <div v-if="summary.largest" class="font-semibold truncate" :title="summary.largest.name">{{ summary.largest.name }}</div>
          <div v-if="summary.largest" class="text-xs tabular-nums">{{ fmtRows(summary.largest.rows) }} rows ({{ share(summary.largest.rows) }})</div>
          <div class="flex flex-wrap gap-3 mt-1 text-xs"><span v-for="s in summary.bySource" :key="s.label"><span class="text-muted-foreground">{{ s.label }}:</span> {{ s.des }} DEs, {{ s.rows.toLocaleString() }} rows</span></div>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <button class="px-3 h-8" :class="view === 'des' ? 'bg-accent font-medium' : ''" @click="view = 'des'">By data extension</button>
          <button class="px-3 h-8 border-l border-border" :class="view === 'folders' ? 'bg-accent font-medium' : ''" @click="hasPaths ? (view = 'folders') : loadFolders()">By folder</button>
        </div>
        <input v-model="filter" type="search" placeholder="Filter by name" aria-label="Filter by name" class="h-8 w-56 rounded-md border border-border bg-background px-2 text-xs" @input="limit = DE_PAGE_SIZE" />
        <label class="flex items-center gap-1.5 text-xs text-muted-foreground"><input v-model="hideSystem" type="checkbox" /> Hide system DEs ({{ summary.system }})</label>
        <div class="flex-1" />
        <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy" @click="loadFolders"><FolderTree class="h-3.5 w-3.5 mr-1" /> {{ hasPaths ? 'Folders again' : 'Get folders' }}</Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" @click="downloadCsv"><Download class="h-3.5 w-3.5 mr-1" /> CSV</Button>
      </div>

      <section v-if="view === 'des'" class="rounded-lg border border-border bg-card p-3">
        <table class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border">
            <th class="py-1 pr-3">Data extension</th><th class="py-1 pr-3">Source</th><th class="py-1 pr-3 text-right">Rows</th><th class="py-1 pr-3 text-right">Share</th>
            <th v-if="hasPaths" class="py-1 pr-3">Folder</th><th class="py-1 pr-3">Modified</th>
          </tr></thead>
          <tbody><tr v-for="r in shown" :key="r.id" class="border-b border-border/50">
            <td class="py-1 pr-3"><RouterLink :to="{ path: '/data-extensions', query: { q: r.name } }" class="font-medium hover:underline">{{ r.name }}</RouterLink><span class="block text-muted-foreground">{{ r.customerKey }}</span></td>
            <td class="py-1 pr-3">{{ sourceLabel(r) }}</td>
            <td class="py-1 pr-3 text-right tabular-nums"><span v-if="r.rowError" class="text-red-600" :title="r.rowError">Error</span><template v-else>{{ fmtRows(r.rows) }}</template></td>
            <td class="py-1 pr-3 text-right tabular-nums text-muted-foreground">{{ r.rows ? share(r.rows) : '' }}</td>
            <td v-if="hasPaths" class="py-1 pr-3 text-muted-foreground">{{ paths[r.categoryId] || '' }}</td>
            <td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(r.modifiedDate) }}</td>
          </tr></tbody>
        </table>
        <div class="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <span>Showing {{ shown.length.toLocaleString() }} of {{ visible.length.toLocaleString() }}</span>
          <Button v-if="shown.length < visible.length" variant="outline" size="sm" class="h-7 text-xs" @click="limit += DE_PAGE_SIZE">Load 50 more</Button>
        </div>
      </section>

      <section v-else class="rounded-lg border border-border bg-card p-3">
        <p v-if="phase === 'folders'" class="text-xs text-muted-foreground"><Loader2 class="inline h-3.5 w-3.5 mr-1 animate-spin" /> Reading folders</p>
        <table v-else class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Folder</th><th class="py-1 pr-3 text-right">Data extensions</th><th class="py-1 pr-3 text-right">Rows</th><th class="py-1 pr-3 text-right">Share</th></tr></thead>
          <tbody><tr v-for="f in folders" :key="f.path" class="border-b border-border/50">
            <td class="py-1 pr-3">{{ f.path }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ f.des.toLocaleString() }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ f.rows.toLocaleString() }}</td>
            <td class="py-1 pr-3 text-right tabular-nums text-muted-foreground">{{ share(f.rows) }}</td>
          </tr></tbody>
        </table>
      </section>
    </template>
  </div>
</template>
