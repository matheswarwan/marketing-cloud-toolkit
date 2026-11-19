<script setup>
// Automations (SFMC Automation Viewer's Automation Viewer tab): search by name or list
// all, newest run first; View opens the automation without pausing it.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Loader2, Workflow } from 'lucide-vue-next'
import DataTable from '@/components/results/DataTable.vue'
import { setBrowseList } from '@/utils/browseList.js'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import WatchButton from '@/components/automation/WatchButton.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { automationRunState } from '@/utils/runProgress.js'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useStack, whenStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { showToast } from '@/composables/useToast.js'
import { searchAutomations, loadMoreAutomations, automationChanges, searchAutomationsInFolder } from '@/utils/automationApi.js'
import { cachedList, storedList, saveList } from '@/utils/listCache.js'
import { savedAgo } from '@/utils/localCache.js'
import { automationFolderLoader, inFolder } from '@/utils/folderLoaders.js'
import ContentFolderTree from '@/components/content/ContentFolderTree.vue'
import { formatDateTime, plural } from '@/utils/format.js'
import { automationsDoc } from '@/utils/automationDoc.js'
import { automationStatusName } from '@/utils/watches.js'

const router = useRouter()
const { stack } = useStack()
const query = ref('')
const searched = ref(null)
const entries = ref([])
const listFolder = ref(null) // folder id the list shows in full (#1119), else null
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
// Folder tree (feedback #1064): picking a folder lists its automations.
const folder = ref(null)
const folderLoad = computed(() => (stack.value ? automationFolderLoader(stack.value, 'automations') : null))
watch(folder, () => search('open'))

const listInfo = ref(null)
async function search(mode = 'search') {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  loading.value = true
  error.value = ''
  try {
    const params = { query: query.value.trim(), categoryId: folder.value?.id ?? null }
    // Feedback #1069: stored 30 days; a folder shows the stored list, Search reads the
    // automations changed since (status and last run only change with Refresh).
    let r = mode === 'open' ? await storedList(stack.value, 'automations2', params) : null
    if (r) r = { ...r, mode: 'stored' }
    else r = await withReconnect(stack.value, () => cachedList({
      stack: stack.value, kind: 'automations2', params, force: mode === 'refresh',
      full: async () => {
        if (params.categoryId == null) { const x = await searchAutomations(stack.value, params.query, 0); return { items: x.entries, total: x.total } }
        const x = await searchAutomationsInFolder(stack.value, params.query, params.categoryId)
        if (x.unsupported) throw Object.assign(new Error('folder-unsupported'), { folderUnsupported: true })
        return { items: x.entries, total: x.total }
      },
      // A folder is read in full (its folder filter cannot be combined with the change sort).
      changes: params.categoryId == null ? (since) => automationChanges(stack.value, params.query, null, since) : null,
    }))
    listInfo.value = { savedAt: r.savedAt, mode: r.mode, changed: r.changed }
    entries.value = r.items.filter((a) => inFolder(a, folder.value?.id))
    listFolder.value = params.categoryId != null && !params.query ? params.categoryId : null // tree items (#1119)
    // SFMC ignored the folder: count what is shown (feedback #1064).
    total.value = entries.value.length < r.items.length ? entries.value.length : r.total
    picked.value = new Set()
    searched.value = query.value.trim()
  } catch (e) {
    if (e?.folderUnsupported) {
      entries.value = []
      total.value = 0
      searched.value = query.value.trim()
      error.value = `SFMC did not filter the automations by folder with any of the requests the Toolkit knows, so the folder "${folder.value?.name}" cannot be listed yet. Open the folder in Automation Studio with the browser's Network tab open and send the list request through Report.`
    } else error.value = searchError(e, 'search automations')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const r = folder.value
      ? await searchAutomationsInFolder(stack.value, searched.value, folder.value.id, entries.value.length).then((x) => ({ entries: x.entries || [], total: x.total }))
      : await loadMoreAutomations(stack.value, searched.value, entries.value)
    entries.value = [...entries.value, ...r.entries.filter((a) => inFolder(a, folder.value?.id))]
    // Nothing new although SFMC counts more: stop offering Load more.
    total.value = r.entries.length ? r.total : entries.value.length
    saveList(stack.value, 'automations2', { query: searched.value, categoryId: folder.value?.id ?? null }, entries.value, total.value)
    if (!r.entries.length) showToast('SFMC returned no more automations.')
  } catch (e) {
    showToast(`Could not load more: ${e.message}`)
  } finally {
    loadingMore.value = false
  }
}

// ── Download one, several or all shown (feedback #40) ───
const picked = ref(new Set())
const filtered = ref(null) // rows left by the table's column filters, null when none (#126)
const pickable = computed(() => filtered.value || entries.value)
const allPicked = computed(() => pickable.value.length > 0 && pickable.value.every((a) => picked.value.has(a.id)))
function togglePick(id) {
  const next = new Set(picked.value)
  next.has(id) ? next.delete(id) : next.add(id)
  picked.value = next
}
function togglePickAll() {
  picked.value = allPicked.value ? new Set() : new Set(pickable.value.map((a) => a.id))
}
const docProgress = ref(null) // { done, total } while the export loads
async function buildDoc() {
  const list = picked.value.size ? entries.value.filter((a) => picked.value.has(a.id)) : entries.value
  docProgress.value = { done: 0, total: list.length }
  try {
    return await automationsDoc(stack.value, list, { onProgress: (done, total) => { docProgress.value = { done, total } } })
  } finally {
    docProgress.value = null
  }
}

useRouteSearch('/automations', (q) => { query.value = q; whenStack(search) })

const columns = [
  { key: 'pick', label: '', hideable: false, class: 'w-8' },
  { key: 'name', label: 'Name', hideable: false },
  { key: 'status', label: 'Status', sortValue: (r) => automationStatusName(r.status) },
  { key: 'lastRunStatus', label: 'Last run', sortValue: (r) => automationStatusName(r.lastRunStatus) },
  { key: 'lastRunTime', label: 'Last run at', class: 'whitespace-nowrap', type: 'date' },
  { key: 'modifiedDate', label: 'Modified', class: 'whitespace-nowrap', type: 'date' },
  { key: 'actions', label: '', hideable: false, class: 'text-right' },
]
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <form class="flex items-center gap-2" @submit.prevent="search('search')">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="query" type="search" placeholder="Automation name (empty lists all)" aria-label="Automation name"
            class="h-8 w-72 rounded-md border border-border bg-background pl-7 pr-2 text-xs" />
        </div>
        <Button size="sm" class="h-8 text-xs" type="submit" :disabled="loading"><Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /> Search</Button>
      </form>
      <span class="text-xs text-muted-foreground">Viewing an automation never pauses or changes it.</span>
    </div>
    <div class="flex-1 min-h-0 flex max-[760px]:flex-col">
    <ContentFolderTree v-model="folder" :stack="stack" :load="folderLoad" cache-kind="automations" all-label="All automations" :items="entries" :items-folder="listFolder" :items-total="total" :item-icon="Workflow" @item="(a) => router.push(`/automations/${encodeURIComponent(a.id)}`)" class="w-60 shrink-0 border-r border-border max-[760px]:w-full max-[760px]:max-h-48 max-[760px]:border-r-0 max-[760px]:border-b" />
    <div class="flex-1 min-w-0 overflow-y-auto p-4">
      <SfmcErrorNotice :error="error" :retrying="loading" @retry="search('search')" />
      <div v-if="searched === null && !loading" class="max-w-md mx-auto mt-12 text-center text-sm text-muted-foreground">
        Search for an automation by name, or search with an empty box to list all, most recently run first.
      </div>
      <template v-else-if="searched !== null">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <p class="text-xs text-muted-foreground flex-1">{{ total.toLocaleString() }} found{{ searched ? ` for "${searched}"` : '' }}.{{ entries.length < total ? ` Download covers the ${entries.length} shown; load more to include more.` : '' }} <template v-if="listInfo?.mode === 'stored'">Stored {{ savedAgo(listInfo.savedAt) }}: Search reads only the changes.</template><template v-else-if="listInfo?.mode === 'delta'">{{ listInfo.changed ? `${plural(listInfo.changed, 'change')} read from SFMC.` : 'No changes in SFMC since the last read.' }}</template>{{ ' ' }}
            <button type="button" class="underline hover:text-foreground" title="Read the whole list again from SFMC (statuses, last runs, deletions)" data-list-refresh @click="search('refresh')">Refresh</button></p>
          <ProgressBar v-if="docProgress" :value="docProgress.done" :max="docProgress.total" label="Loading" show-count class="w-56" />
          <WatchButton v-if="entries.length" bulk :stack="stack" :items="entries.filter((a) => picked.has(a.id))" />
          <DownloadMenu v-if="entries.length" :get-doc="buildDoc" :file-name="picked.size === 1 ? entries.find((a) => picked.has(a.id))?.name || 'automation' : `automations-${searched || 'all'}`"
            :label="picked.size ? `Download ${picked.size}` : `Download all ${entries.length}`" />
        </div>
        <DataTable :columns="columns" :rows="entries" row-key="id" storage-key="automations" empty-text="No automations found." @shown="filtered = $event" @ordered="setBrowseList('automations', $event)">
          <template #head-pick>
            <input type="checkbox" :checked="allPicked" aria-label="Select every automation shown" @change="togglePickAll" />
          </template>
          <template #cell-pick="{ row }">
            <input type="checkbox" :checked="picked.has(row.id)" :aria-label="`Select ${row.name}`" @change="togglePick(row.id)" />
          </template>
          <template #cell-name="{ row }">
            <RouterLink :to="`/automations/${encodeURIComponent(row.id)}`" class="font-medium hover:underline">{{ row.name || 'Untitled automation' }}</RouterLink>
          </template>
          <template #cell-status="{ row }">
            <StatusBadge :status="row.status" automation />
            <ProgressBar v-if="automationRunState(row).running" indeterminate size="xs" :label="automationRunState(row).step ? automationRunState(row).label : ''"
              aria-label="Running" class="mt-1 w-28" />
          </template>
          <template #cell-lastRunStatus="{ row }"><StatusBadge :status="row.lastRunStatus" automation /></template>
          <template #cell-lastRunTime="{ row }">{{ formatDateTime(row.lastRunTime) }}</template>
          <template #cell-modifiedDate="{ row }">{{ formatDateTime(row.modifiedDate) }}</template>
          <template #cell-actions="{ row }">
            <button class="text-primary hover:underline" @click="router.push(`/automations/${encodeURIComponent(row.id)}`)">View</button>
          </template>
        </DataTable>
        <div v-if="entries.length < total" class="mt-3 text-center">
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loadingMore" @click="loadMore">
            <Loader2 v-if="loadingMore" class="h-3.5 w-3.5 mr-1 animate-spin" /> Load {{ Math.min(50, total - entries.length) }} more ({{ entries.length }} of {{ total }})
          </Button>
        </div>
      </template>
    </div>
    </div>
  </div>
</template>
