<script setup>
// Data extension storage (feedback #68): how much space data extensions use, from
// Contact Builder's storage calls (utils/storageApi.js): the total per day, totals
// by business unit, and every data extension with its rows and size, largest
// first. When those calls fail, row counts can be read instead (RowCountStorage).
// Kept per stack and BU while the tab is open (utils/pageCache.js). The storage
// calls answer only in the parent (Enterprise) BU (feedback #125): from a known
// child BU the page says so without calling, with Try anyway.
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, ref } from 'vue'
import { Loader2, RefreshCw, Download, FileSpreadsheet, Search } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import StackedBars from '@/components/results/StackedBars.vue'
import RowCountStorage from '@/components/storage/RowCountStorage.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { fetchCurrentBUDetails } from '@/utils/sfmcApi.js'
import { fetchStorageDetails, fetchStorageHistory, byBusinessUnit, formatGB, storageDetailsCsv, storageFailureNotice } from '@/utils/storageApi.js'
import { pageCacheKey, readPageCache, writePageCache } from '@/utils/pageCache.js'
import { downloadWorkbook } from '@/utils/exportDoc.js'
import { exportBaseName } from '@/utils/exportName.js'
import { saveTextFile } from '@/utils/download.js'
import { formatDateTime } from '@/utils/format.js'
import { RESULTS_PAGE_SIZE } from '@/utils/paging.js'

const { stack } = useStack()
const items = ref(null)
const history = ref([])
const loading = ref(false)
const error = ref(null) // { notice, detail, childBU } from storageFailureNotice
let bu = null
const historyError = ref('')
const days = ref(30)
const filter = ref('')
const sortBy = ref('gb')
const visible = ref(RESULTS_PAGE_SIZE)
const savedAt = ref(0)
let cacheKey = ''

async function currentKey() {
  bu = await fetchCurrentBUDetails(stack.value).catch(() => null)
  return pageCacheKey('de-storage', stack.value, bu?.accountId)
}
const save = () => { if (cacheKey) savedAt.value = writePageCache(cacheKey, { items: items.value, history: history.value, historyError: historyError.value, days: days.value }).savedAt }

async function load({ force = false } = {}) {
  if (!stack.value) { error.value = { notice: 'Not connected to Marketing Cloud.', detail: '' }; return }
  loading.value = true
  error.value = null
  historyError.value = ''
  cacheKey = await currentKey()
  if (bu?.isChild === true && !force) {
    items.value = null
    error.value = storageFailureNotice('', bu)
    loading.value = false
    return
  }
  const [d, h] = await Promise.allSettled([fetchStorageDetails(stack.value), fetchStorageHistory(stack.value, days.value)])
  if (d.status === 'fulfilled') items.value = d.value.items
  else { items.value = null; error.value = storageFailureNotice(d.reason, bu) }
  if (h.status === 'fulfilled') history.value = h.value
  else { history.value = []; historyError.value = `Could not read the storage history: ${h.reason?.message}` }
  loading.value = false
  if (items.value) save()
}

async function loadHistory() {
  historyError.value = ''
  try { history.value = await fetchStorageHistory(stack.value, days.value) } catch (e) { historyError.value = `Could not read the storage history: ${e.message}` }
  save()
}

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  const list = (items.value || []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q) || d.businessUnit.toLowerCase().includes(q))
  return [...list].sort((a, b) => (sortBy.value === 'rows' ? b.rows - a.rows : sortBy.value === 'name' ? a.name.localeCompare(b.name) : b.gb - a.gb || b.rows - a.rows))
})
const totals = computed(() => (items.value || []).reduce((t, d) => ({ gb: t.gb + d.gb, rows: t.rows + d.rows }), { gb: 0, rows: 0 }))
const units = computed(() => byBusinessUnit(items.value || []))
const latest = computed(() => history.value.at(-1) || null)
const change = computed(() => (history.value.length > 1 ? history.value.at(-1).gb - history.value[0].gb : null))
const dayLabel = (r) => new Date(`${r.key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const SERIES = [{ key: 'gb', label: 'GB used', color: '#2a78d6' }]
const share = (gb) => (totals.value.gb ? `${((100 * gb) / totals.value.gb).toFixed(1)}%` : '')

async function exportExcel() {
  const name = await exportBaseName(stack.value, 'data-extension-storage')
  await downloadWorkbook([
    { name: 'Data extensions', columns: ['Name', 'Path', 'Business unit', 'MID', 'Rows', 'GB', 'Retention', 'Sendable', 'Type', 'External key', 'Sampled'],
      rows: shown.value.map((d) => [d.name, d.path, d.businessUnit, d.mid, d.rows, Number(d.gb.toFixed(5)), d.retention, d.sendable ? 'Yes' : 'No', d.type, d.externalKey, d.sampleDate]) },
    { name: 'Business units', columns: ['Business unit', 'Data extensions', 'Rows', 'GB'], rows: units.value.map((u) => [u.businessUnit, u.count, u.rows, Number(u.gb.toFixed(5))]) },
    { name: 'History', columns: ['Date', 'GB', 'Rows', 'Data extensions'], rows: history.value.map((h) => [h.key, Number(h.gb.toFixed(5)), h.rows, h.count]) },
  ], `${name}.xlsx`)
}
async function exportCsv() {
  const name = await exportBaseName(stack.value, 'data-extension-storage')
  saveTextFile(storageDetailsCsv(shown.value), `${name}.csv`, 'text/csv', 'CSV file')
}

// Last, so everything start touches is defined when it runs straight away.
whenStack(async () => {
  if (!stack.value) return load()
  cacheKey = await currentKey()
  const saved = readPageCache(cacheKey)
  if (!saved?.items) return load()
  items.value = saved.items
  history.value = saved.history || []
  historyError.value = saved.historyError || ''
  days.value = saved.days || 30
  savedAt.value = saved.savedAt
})
</script>

<template>
  <div class="h-full overflow-y-auto p-4 space-y-4 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-base font-semibold flex-1">Data extension storage</h1>
      <span v-if="savedAt && !loading" class="text-xs text-muted-foreground">Read {{ formatDateTime(new Date(savedAt).toISOString()) }}</span>
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="!items?.length" @click="exportCsv"><Download class="h-3.5 w-3.5 mr-1" /> CSV</Button>
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="!items?.length" @click="exportExcel"><FileSpreadsheet class="h-3.5 w-3.5 mr-1" /> Excel</Button>
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loading" @click="load()">
        <Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5 mr-1" /> Refresh
      </Button>
    </div>
    <ProgressBar v-if="loading && !items" indeterminate label="Reading storage from SFMC" class="max-w-md" />
    <template v-if="error">
      <div class="rounded-md border px-3 py-2 text-xs space-y-1" role="alert"
        :class="error.childBU === false ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'">
        <p>{{ error.notice }}</p>
        <p v-if="error.childBU === true"><button class="underline" :disabled="loading" @click="load({ force: true })">Try anyway</button></p>
        <details v-if="error.detail"><summary class="cursor-pointer">Error from SFMC</summary><pre class="mt-1 whitespace-pre-wrap break-all">{{ error.detail }}</pre></details>
      </div>
      <section class="rounded-lg border border-border bg-card p-3"><RowCountStorage /></section>
    </template>

    <template v-if="items">
      <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Used</div><div class="text-2xl font-semibold tabular-nums">{{ formatGB(latest?.gb ?? totals.gb) }} GB</div>
          <div v-if="change !== null" class="text-[11px] text-muted-foreground">{{ change >= 0 ? '+' : '-' }}{{ formatGB(Math.abs(change)) }} GB since {{ dayLabel(history[0]) }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Rows</div><div class="text-2xl font-semibold tabular-nums">{{ (latest?.rows || totals.rows).toLocaleString() }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Data extensions</div><div class="text-2xl font-semibold tabular-nums">{{ items.length.toLocaleString() }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Business units</div><div class="text-2xl font-semibold tabular-nums">{{ units.length }}</div>
          <div class="text-[11px] text-muted-foreground">Sizes are SFMC's daily sample{{ items[0]?.sampleDate ? ` (${items[0].sampleDate})` : '' }}.</div></div>
      </section>

      <section class="rounded-lg border border-border bg-card p-3">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-semibold flex-1">Storage over time</h2>
          <select v-model.number="days" class="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="History days" @change="loadHistory">
            <option :value="30">Last 30 days</option><option :value="90">Last 90 days</option><option :value="365">Last year</option>
          </select>
        </div>
        <p v-if="historyError" class="text-xs text-red-600">{{ historyError }}</p>
        <StackedBars v-else-if="history.length" :rows="history" :series="SERIES" :label-of="dayLabel" :title="`Storage used per day, last ${days} days`" />
        <p v-else class="text-xs text-muted-foreground">No storage history.</p>
      </section>

      <section v-if="units.length > 1" class="rounded-lg border border-border bg-card p-3">
        <h2 class="font-semibold mb-2">By business unit</h2>
        <table class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Business unit</th><th class="py-1 pr-3 text-right">Data extensions</th><th class="py-1 pr-3 text-right">Rows</th><th class="py-1 pr-3 text-right">GB</th><th class="py-1 w-1/3"></th></tr></thead>
          <tbody><tr v-for="u in units" :key="u.businessUnit" class="border-b border-border/50">
            <td class="py-1 pr-3">{{ u.businessUnit }}</td><td class="py-1 pr-3 text-right tabular-nums">{{ u.count.toLocaleString() }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ u.rows.toLocaleString() }}</td><td class="py-1 pr-3 text-right tabular-nums">{{ formatGB(u.gb) }}</td>
            <td class="py-1"><div class="h-2 rounded bg-primary/70" :style="{ width: `${Math.max(1, 100 * u.gb / (units[0].gb || 1))}%` }" /></td>
          </tr></tbody>
        </table>
      </section>

      <section class="rounded-lg border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-semibold flex-1">Data extensions</h2>
          <div class="relative"><Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input v-model="filter" type="search" placeholder="Name, folder or business unit" aria-label="Filter data extensions" class="h-7 w-64 rounded-md border border-border bg-background pl-7 pr-2 text-xs" @input="visible = RESULTS_PAGE_SIZE" /></div>
          <select v-model="sortBy" class="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="Sort by">
            <option value="gb">Largest first</option><option value="rows">Most rows first</option><option value="name">By name</option>
          </select>
        </div>
        <table class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Name</th><th class="py-1 pr-3">Folder</th><th class="py-1 pr-3">Business unit</th><th class="py-1 pr-3 text-right">Rows</th><th class="py-1 pr-3 text-right">GB</th><th class="py-1 pr-3 text-right">Share</th><th class="py-1 pr-3">Retention</th></tr></thead>
          <tbody><tr v-for="d in shown.slice(0, visible)" :key="d.key" class="border-b border-border/50">
            <td class="py-1 pr-3"><RouterLink :to="{ path: '/data-extensions', query: { q: d.name } }" class="font-medium hover:underline">{{ d.name }}</RouterLink><span v-if="d.sendable" class="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">Sendable</span></td>
            <td class="py-1 pr-3 text-muted-foreground">{{ d.path }}</td><td class="py-1 pr-3">{{ d.businessUnit }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ d.rows.toLocaleString() }}</td><td class="py-1 pr-3 text-right tabular-nums">{{ d.found ? formatGB(d.gb) : 'n/a' }}</td>
            <td class="py-1 pr-3 text-right tabular-nums text-muted-foreground">{{ d.found && d.gb ? share(d.gb) : '' }}</td>
            <td class="py-1 pr-3">{{ d.retention }}</td>
          </tr></tbody>
        </table>
        <div v-if="visible < shown.length" class="mt-3 text-center">
          <Button variant="outline" size="sm" class="h-8 text-xs" @click="visible += RESULTS_PAGE_SIZE">Load {{ Math.min(50, shown.length - visible) }} more ({{ visible }} of {{ shown.length.toLocaleString() }})</Button>
        </div>
      </section>
    </template>
  </div>
</template>
