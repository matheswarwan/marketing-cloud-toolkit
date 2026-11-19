<script setup>
// Journeys: search Journey Builder journeys by name or list all, newest change
// first; View draws the journey. Read-only.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Loader2, Route } from 'lucide-vue-next'
import DataTable from '@/components/results/DataTable.vue'
import { setBrowseList } from '@/utils/browseList.js'
import StatusBadge from '@/components/results/StatusBadge.vue'
import Button from '@/components/ui/button/Button.vue'
import WatchButton from '@/components/automation/WatchButton.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { showToast } from '@/composables/useToast.js'
import { automationFolderLoader, inFolder } from '@/utils/folderLoaders.js'
import ContentFolderTree from '@/components/content/ContentFolderTree.vue'
import { cachedList, storedList, saveList } from '@/utils/listCache.js'
import { savedAgo } from '@/utils/localCache.js'
import { journeyChanges, searchJourneys, JOURNEY_STATUSES, JOURNEY_PAGE_SIZE } from '@/utils/journeys.js'
import { formatDateTime, plural, statusWords } from '@/utils/format.js'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'

const router = useRouter()
const { stack } = useStack()
const query = ref('')
const status = ref('')
const searched = ref(null) // { query, status }
const items = ref([])
const listFolder = ref(null) // folder id the list shows in full (#1119), else null
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
// Folder tree (feedback #1064): picking a folder lists its journeys.
const folder = ref(null)
const folderLoad = computed(() => (stack.value ? automationFolderLoader(stack.value, 'journey') : null))
watch(folder, () => search('open'))

const listInfo = ref(null)
async function search(mode = 'search') {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  loading.value = true
  error.value = ''
  try {
    const params = { query: query.value.trim(), status: status.value, categoryId: folder.value?.id ?? null }
    // Feedback #1069: stored 30 days; a folder shows the stored list, Search reads the changes.
    let r = mode === 'open' ? await storedList(stack.value, 'journeys', params) : null
    if (r) r = { ...r, mode: 'stored' }
    else r = await withReconnect(stack.value, () => cachedList({
      stack: stack.value, kind: 'journeys', params, force: mode === 'refresh',
      full: () => searchJourneys(stack.value, { ...params, page: 1 }),
      changes: (since) => journeyChanges(stack.value, params, since),
      sortBy: (x, y) => String(y.modifiedDate || '').localeCompare(String(x.modifiedDate || '')),
    }))
    listInfo.value = { savedAt: r.savedAt, mode: r.mode, changed: r.changed }
    items.value = r.items.filter((j) => inFolder(j, folder.value?.id))
    listFolder.value = params.categoryId != null && !params.query && !params.status ? params.categoryId : null // tree items (#1119)
    // SFMC ignored the folder: count what is shown (feedback #1064).
    total.value = items.value.length < r.items.length ? items.value.length : r.total
    page.value = Math.max(1, Math.ceil(r.items.length / JOURNEY_PAGE_SIZE))
    searched.value = { query: query.value.trim(), status: status.value, categoryId: folder.value?.id ?? null }
  } catch (e) {
    error.value = searchError(e, 'search journeys')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const r = await searchJourneys(stack.value, { ...searched.value, page: page.value + 1 })
    const have = new Set(items.value.map((j) => j.id))
    items.value = [...items.value, ...r.items.filter((j) => inFolder(j, searched.value?.categoryId) && !have.has(j.id))]
    page.value++
    saveList(stack.value, 'journeys', { query: searched.value.query, status: searched.value.status, categoryId: searched.value.categoryId }, items.value, total.value)
  } catch (e) {
    showToast(`Could not load more: ${e.message}`)
  } finally {
    loadingMore.value = false
  }
}

useRouteSearch('/journeys', (q) => { query.value = q; whenStack(search) })

const view = (j) => router.push({ path: `/journeys/${encodeURIComponent(j.id)}`, query: j.version ? { version: String(j.version) } : {} })

// Tick journeys to watch several at once (feedback #59).
const picked = ref(new Set())
const filtered = ref(null) // rows left by the table's column filters, null when none (#126)
const pickable = computed(() => filtered.value || items.value)
const allPicked = computed(() => pickable.value.length > 0 && pickable.value.every((j) => picked.value.has(j.id)))
function togglePick(id) {
  const next = new Set(picked.value)
  next.has(id) ? next.delete(id) : next.add(id)
  picked.value = next
}
function togglePickAll() {
  picked.value = allPicked.value ? new Set() : new Set(pickable.value.map((j) => j.id))
}

const columns = [
  { key: 'pick', label: '', hideable: false, class: 'w-8' },
  { key: 'name', label: 'Name', hideable: false },
  { key: 'status', label: 'Status' },
  { key: 'version', label: 'Version' },
  { key: 'modifiedDate', label: 'Modified', class: 'whitespace-nowrap', type: 'date' },
  { key: 'lastPublishedDate', label: 'Last published', class: 'whitespace-nowrap', type: 'date' },
  { key: 'description', label: 'Description' },
  { key: 'actions', label: '', hideable: false, class: 'text-right' },
]
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <form class="flex items-center gap-2" @submit.prevent="search('search')">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="query" type="search" placeholder="Journey name or description (empty lists all)" aria-label="Journey name"
            class="h-8 w-80 rounded-md border border-border bg-background pl-7 pr-2 text-xs" />
        </div>
        <select v-model="status" class="h-8 rounded-md border border-border bg-background px-1 text-xs" aria-label="Status">
          <option value="">Any status</option>
          <option v-for="s in JOURNEY_STATUSES" :key="s" :value="s">{{ statusWords(s) }}</option>
        </select>
        <Button size="sm" class="h-8 text-xs" type="submit" :disabled="loading"><Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /> Search</Button>
      </form>
      <span class="text-xs text-muted-foreground">Viewing a journey never changes it.</span>
    </div>
    <div class="flex-1 min-h-0 flex max-[760px]:flex-col">
    <ContentFolderTree v-model="folder" :stack="stack" :load="folderLoad" cache-kind="journeys" all-label="All journeys" :items="items" :items-folder="listFolder" :items-total="total" :item-icon="Route" @item="view" class="w-60 shrink-0 border-r border-border max-[760px]:w-full max-[760px]:max-h-48 max-[760px]:border-r-0 max-[760px]:border-b" />
    <div class="flex-1 min-w-0 overflow-y-auto p-4">
      <SfmcErrorNotice :error="error" :retrying="loading" @retry="search('search')" />
      <div v-if="searched === null && !loading" class="max-w-md mx-auto mt-12 text-center text-sm text-muted-foreground">
        Search for a journey by name, or search with an empty box to list all, most recently changed first.
      </div>
      <template v-else-if="searched !== null">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <p class="text-xs text-muted-foreground flex-1">{{ total.toLocaleString() }} found{{ searched.query ? ` for "${searched.query}"` : '' }}{{ searched.status ? `, status ${searched.status}` : '' }}. <template v-if="listInfo?.mode === 'stored'">Stored {{ savedAgo(listInfo.savedAt) }}: Search reads only the changes.</template><template v-else-if="listInfo?.mode === 'delta'">{{ listInfo.changed ? `${plural(listInfo.changed, 'change')} read from SFMC.` : 'No changes in SFMC since the last read.' }}</template>{{ ' ' }}
            <button type="button" class="underline hover:text-foreground" title="Read the whole list again from SFMC (statuses, last runs, deletions)" data-list-refresh @click="search('refresh')">Refresh</button></p>
          <WatchButton v-if="items.length" bulk type="journey" :stack="stack" :items="items.filter((j) => picked.has(j.id))" />
        </div>
        <DataTable :columns="columns" :rows="items" row-key="id" storage-key="journeys" empty-text="No journeys found." @shown="filtered = $event" @ordered="setBrowseList('journeys', $event.map((j) => ({ id: j.id, name: j.name, query: j.version ? { version: String(j.version) } : null })))">
          <template #head-pick>
            <input type="checkbox" :checked="allPicked" aria-label="Select every journey shown" @change="togglePickAll" />
          </template>
          <template #cell-pick="{ row }">
            <input type="checkbox" :checked="picked.has(row.id)" :aria-label="`Select ${row.name}`" @change="togglePick(row.id)" />
          </template>
          <template #cell-name="{ row }">
            <button class="font-medium text-left hover:underline" @click="view(row)">{{ row.name || 'Untitled journey' }}</button>
          </template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          <template #cell-modifiedDate="{ row }">{{ formatDateTime(row.modifiedDate) }}</template>
          <template #cell-lastPublishedDate="{ row }">{{ formatDateTime(row.lastPublishedDate) }}</template>
          <template #cell-description="{ row }"><span class="line-clamp-2 text-muted-foreground">{{ row.description }}</span></template>
          <template #cell-actions="{ row }"><button class="text-primary hover:underline" @click="view(row)">View</button></template>
        </DataTable>
        <div v-if="page * JOURNEY_PAGE_SIZE < total" class="mt-3 text-center">
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loadingMore" @click="loadMore">
            <Loader2 v-if="loadingMore" class="h-3.5 w-3.5 mr-1 animate-spin" /> Load {{ Math.min(50, total - items.length) }} more ({{ items.length }} of {{ total }})
          </Button>
        </div>
      </template>
    </div>
    </div>
  </div>
</template>
