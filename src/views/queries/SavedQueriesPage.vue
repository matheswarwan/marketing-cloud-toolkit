<script setup>
// Saved queries: captured from Query Studio, added by hand, imported, or saved from
// the Workspace and Query Builder (from SFMC Query Saver's main page).
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Plus, Download, Upload, Trash2, Star, Rows3, LayoutGrid, X, Play, Blocks } from 'lucide-vue-next'
import QueryCard from '@/components/cards/QueryCard.vue'
import DateSidebar from '@/components/layout/DateSidebar.vue'
import AddQueryModal from '@/components/modals/AddQueryModal.vue'
import QueryPreviewModal from '@/components/modals/QueryPreviewModal.vue'
import Button from '@/components/ui/button/Button.vue'
import { groupByDate } from '@/utils/dateGroups.js'
import { queriesToCsv, csvToQueryRecords, csvFileName } from '@/utils/queryCsv.js'
import { saveTextFile, readFileText } from '@/utils/download.js'
import { useStoredSetting } from '@/composables/useStoredSetting.js'
import { showToast } from '@/composables/useToast.js'
import { useStack } from '@/composables/useStack.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'

const router = useRouter()

const queries = ref([])
const search = ref('')
const activeDateFilter = ref(null)
const activeBuFilters = ref(new Set())
const favouritesOnly = ref(false)
const { value: cardSize } = useStoredSetting('cardSize', 'compact', (v) => (v === 'large' ? 'large' : 'compact'))

const showAddModal = ref(false)
const previewCard = ref(null)
const deleteMode = ref(false)
const selectedIds = ref(new Set())
const csvInput = ref(null)

// ── Data ─────────────────────────────────────────────────
function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (raw) => {
      queries.value = Object.values(raw || {})
        // Workspace panels that were never typed in are stored too; they aren't saved queries.
        .filter((v) => v && typeof v.queryText === 'string' && String(v.id || '').startsWith('sql_') &&
          (v.queryText.trim() || v.runs?.length))
        .map((v) => ({
          id: v.id,
          queryText: v.queryText || v.runs?.[0]?.queryText || '',
          timeStamp: v.timeStamp,
          url: v.url,
          name: v.name,
          isFavourite: !!v.isFavourite,
          businessUnit: v.businessUnit || null,
          source: v.source || null,
        }))
        .sort((a, b) => b.timeStamp - a.timeStamp)
      resolve()
    })
  })
}

// New captures (Query Studio, another tab) show up without a reload.
let reloadTimer = null
function onStorageChange(changes, area) {
  if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('sql_'))) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(loadData, 300)
}
onMounted(() => { loadData(); chrome.storage.onChanged.addListener(onStorageChange) })
onUnmounted(() => chrome.storage.onChanged.removeListener(onStorageChange))

// ── Current business unit first (feedback #49) ────────────
// When the business unit you are logged in to is known and has saved queries, only
// its queries are shown; Show all (remembered) lists every business unit again.
const SHOW_ALL_KEY = 'toolkit_savedQueries_allBUs'
const { stack } = useStack()
const currentBU = ref(null)
const showAllBUs = ref((() => { try { return localStorage.getItem(SHOW_ALL_KEY) === '1' } catch { return false } })())
const autoBU = ref(false) // the BU filter was set from the current BU, not by hand
function applyCurrentBU() {
  if (showAllBUs.value || !currentBU.value || activeBuFilters.value.size) return
  if (!queries.value.some((q) => q.businessUnit?.name === currentBU.value)) return
  activeBuFilters.value = new Set([currentBU.value])
  autoBU.value = true
}
watch(stack, async (s) => {
  if (!s) return
  try { currentBU.value = (await fetchCurrentBU(s))?.name || null } catch { currentBU.value = null }
  if (autoBU.value) { activeBuFilters.value = new Set(); autoBU.value = false }
  applyCurrentBU()
}, { immediate: true })
watch(queries, applyCurrentBU)
function setShowAll(all) {
  showAllBUs.value = all
  try { localStorage.setItem(SHOW_ALL_KEY, all ? '1' : '0') } catch { /* storage blocked */ }
  if (all) { activeBuFilters.value = new Set(); autoBU.value = false } else applyCurrentBU()
}
function onBuFilterChange(set) {
  activeBuFilters.value = set
  autoBU.value = false
}
const currentBUCount = computed(() => queries.value.filter((q) => q.businessUnit?.name === currentBU.value).length)

// ── Filters and groups ───────────────────────────────────
const buOptions = computed(() => {
  const map = new Map()
  for (const q of queries.value) {
    const bu = q.businessUnit
    if (!bu?.name) continue
    const entry = map.get(bu.name) || { name: bu.name, accountId: bu.accountId, count: 0 }
    entry.count++
    map.set(bu.name, entry)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
})

const filtered = computed(() => queries.value.filter((q) =>
  (!activeBuFilters.value.size || activeBuFilters.value.has(q.businessUnit?.name)) &&
  (!favouritesOnly.value || q.isFavourite)))

// Each date group is split by business unit when it holds more than one.
const allGroups = computed(() => groupByDate(filtered.value).map((g) => {
  const byBu = new Map()
  const noBu = []
  for (const q of g.items) {
    const name = q.businessUnit?.name
    if (name) { if (!byBu.has(name)) byBu.set(name, []); byBu.get(name).push(q) } else noBu.push(q)
  }
  const split = byBu.size > 1 || (byBu.size === 1 && noBu.length > 0)
  return {
    ...g,
    buGroups: split
      ? [...byBu].map(([name, items]) => ({ name, items })).concat(noBu.length ? [{ name: null, items: noBu }] : [])
      : [{ name: null, items: g.items }],
  }
}))
const sidebarGroups = computed(() => allGroups.value.map((g) => ({ key: g.key, label: g.label, count: g.items.length })))
const displayGroups = computed(() => (activeDateFilter.value === null
  ? allGroups.value
  : allGroups.value.filter((g) => g.key === activeDateFilter.value)))
const visibleIds = computed(() => displayGroups.value.flatMap((g) => g.items.map((q) => q.id)))

// ── Actions ──────────────────────────────────────────────
async function toggleFavourite(id) {
  const q = queries.value.find((x) => x.id === id)
  if (!q) return
  const data = await new Promise((r) => chrome.storage.local.get(id, r))
  if (!data[id]) return
  q.isFavourite = !q.isFavourite
  chrome.storage.local.set({ [id]: { ...data[id], isFavourite: q.isFavourite } })
}

function openPreview(id) {
  previewCard.value = queries.value.find((q) => q.id === id) || null
}

function openEditor(id) {
  previewCard.value = null
  const q = queries.value.find((x) => x.id === id)
  router.push({ path: q?.source === 'builder' ? '/queries/builder' : '/queries/workspace', query: { id } })
}

function toggleDeleteMode() {
  deleteMode.value = !deleteMode.value
  selectedIds.value = new Set()
}
function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}
function toggleSelectAll() {
  selectedIds.value = selectedIds.value.size === visibleIds.value.length ? new Set() : new Set(visibleIds.value)
}
async function deleteSelected() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  await new Promise((r) => chrome.storage.local.remove(ids, r))
  await loadData()
  deleteMode.value = false
  selectedIds.value = new Set()
  showToast(`Deleted ${ids.length} ${ids.length === 1 ? 'query' : 'queries'}.`)
}

async function exportCsv() {
  const raw = await new Promise((r) => chrome.storage.local.get(null, r))
  const records = Object.entries(raw).filter(([k]) => k.startsWith('sql_')).map(([, v]) => v)
  await saveTextFile(queriesToCsv(records), csvFileName(), 'text/csv', 'CSV file')
}

async function importCsv(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const entries = csvToQueryRecords(await readFileText(file))
  const count = Object.keys(entries).length
  if (!count) { showToast('No queries found in that CSV.'); return }
  await new Promise((r) => chrome.storage.local.set(entries, r))
  await loadData()
  showToast(`Imported ${count} ${count === 1 ? 'query' : 'queries'}.`)
}

async function onSaved(result) {
  showAddModal.value = false
  await loadData()
  showToast(result === false ? 'Could not save. Please try again.' : 'Query saved.')
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <template v-if="!deleteMode">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="search" type="search" placeholder="Search name, SQL or bu:name"
            class="h-8 w-64 rounded-md border border-border bg-background pl-7 pr-2 text-xs"
            @keyup.esc="search = ''" />
        </div>
        <button class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium"
          :class="favouritesOnly ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400' : 'border-border text-muted-foreground hover:bg-accent'"
          :aria-pressed="favouritesOnly" @click="favouritesOnly = !favouritesOnly">
          <Star class="h-3.5 w-3.5" :fill="favouritesOnly ? 'currentColor' : 'none'" /> Favourites
        </button>
        <button class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-accent"
          :title="cardSize === 'large' ? 'Show smaller cards' : 'Show larger cards with more of the SQL'"
          @click="cardSize = cardSize === 'large' ? 'compact' : 'large'">
          <LayoutGrid v-if="cardSize === 'large'" class="h-3.5 w-3.5" /><Rows3 v-else class="h-3.5 w-3.5" />
          {{ cardSize === 'large' ? 'Compact cards' : 'Large cards' }}
        </button>
        <div class="flex-1" />
        <Button size="sm" class="h-8 text-xs" @click="router.push('/queries/workspace')"><Play class="h-3.5 w-3.5 mr-1" /> Run a query</Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" @click="router.push('/queries/builder')"><Blocks class="h-3.5 w-3.5 mr-1" /> Query Builder</Button>
        <Button variant="ghost" size="icon" class="h-8 w-8" title="Add a query" @click="showAddModal = true"><Plus class="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" class="h-8 w-8" title="Export queries to CSV" @click="exportCsv"><Download class="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" class="h-8 w-8" title="Import queries from CSV" @click="csvInput?.click()"><Upload class="h-4 w-4" /></Button>
        <input ref="csvInput" type="file" accept=".csv,text/csv,text/plain" class="hidden" @change="importCsv" />
        <Button variant="ghost" size="icon" class="h-8 w-8 hover:text-red-600" title="Select queries to delete" :disabled="!queries.length" @click="toggleDeleteMode"><Trash2 class="h-4 w-4" /></Button>
      </template>
      <template v-else>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" :checked="selectedIds.size > 0 && selectedIds.size === visibleIds.length"
            :indeterminate="selectedIds.size > 0 && selectedIds.size < visibleIds.length" @change="toggleSelectAll" />
          Select all shown ({{ visibleIds.length }})
        </label>
        <div class="flex-1" />
        <Button variant="destructive" size="sm" class="h-8 text-xs" :disabled="!selectedIds.size" @click="deleteSelected">
          <Trash2 class="h-3.5 w-3.5 mr-1" /> Delete ({{ selectedIds.size }})
        </Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" @click="toggleDeleteMode"><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
      </template>
    </div>

    <div class="flex-1 min-h-0 flex">
      <DateSidebar v-if="queries.length" :groups="sidebarGroups" :active-key="activeDateFilter" :total-count="filtered.length"
        :bu-options="buOptions" :active-bu-filters="activeBuFilters"
        @select="activeDateFilter = $event" @bu-filter-change="onBuFilterChange" />

      <div class="flex-1 min-w-0 overflow-y-auto p-6">
        <div v-if="autoBU && activeBuFilters.size === 1" class="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span class="flex-1">Showing the {{ currentBUCount }} queries from <strong>{{ currentBU }}</strong>, the business unit you are logged in to.</span>
          <button class="text-primary hover:underline" @click="setShowAll(true)">Show all business units</button>
        </div>
        <div v-else-if="showAllBUs && currentBU && currentBUCount && !activeBuFilters.size" class="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span class="flex-1">Showing every business unit.</span>
          <button class="text-primary hover:underline" @click="setShowAll(false)">Only {{ currentBU }}</button>
        </div>
        <div v-if="!queries.length" class="flex flex-col items-center gap-3 py-16 text-center">
          <p class="text-lg font-semibold">No queries saved yet</p>
          <p class="text-sm text-muted-foreground max-w-sm">Run a query in SFMC Query Studio and it appears here. You can also add one, import a CSV, or import a Query Saver backup in Settings.</p>
          <Button class="mt-2" @click="showAddModal = true">Add a query</Button>
        </div>

        <div v-else-if="!displayGroups.length" class="flex flex-col items-center gap-3 py-12 text-center">
          <p class="text-sm font-semibold">Nothing matches these filters</p>
          <button class="text-xs text-primary underline" @click="favouritesOnly = false; activeBuFilters = new Set(); activeDateFilter = null">Clear filters</button>
        </div>

        <section v-for="group in displayGroups" :key="group.key" class="mb-7">
          <div class="flex items-center gap-2 mb-3">
            <h2 class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{{ group.label }}</h2>
            <span class="text-[11px] text-muted-foreground bg-muted rounded-full px-2 tabular-nums">{{ group.items.length }}</span>
            <div class="flex-1 h-px bg-border" />
          </div>
          <div v-for="bu in group.buGroups" :key="bu.name || '_'" class="mb-4 last:mb-0">
            <div v-if="group.buGroups.length > 1" class="flex items-center gap-1.5 mb-2.5">
              <span class="text-[10px] font-semibold text-primary bg-primary/10 rounded-full px-2 py-px">{{ bu.name || 'No business unit' }}</span>
              <span class="text-[10px] text-muted-foreground tabular-nums">{{ bu.items.length }}</span>
            </div>
            <div class="flex flex-wrap gap-4 items-start">
              <QueryCard v-for="q in bu.items" :key="q.id" v-bind="q" :search="search" :size="cardSize"
                :delete-mode="deleteMode" :is-selected="selectedIds.has(q.id)"
                @toggle-select="toggleSelect" @toggle-favourite="toggleFavourite" @open-preview="openPreview" />
            </div>
          </div>
        </section>
      </div>
    </div>

    <AddQueryModal v-if="showAddModal" @save="onSaved" @validation-error="showToast('Enter a name and the SQL first.')" @close="showAddModal = false" />
    <QueryPreviewModal v-if="previewCard" :card="previewCard" @open-editor="openEditor" @open-builder="(c) => { previewCard = null; router.push({ path: '/queries/builder', query: { sql: c.queryText } }) }" @close="previewCard = null" />
  </div>
</template>
