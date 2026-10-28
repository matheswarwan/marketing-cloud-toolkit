<script setup>
// Emails saved in Content Builder, captured with every version (from SFMC Query
// Saver's Emails tab). Turn capturing on or off in Settings.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Star, Trash2, X, Settings as SettingsIcon } from 'lucide-vue-next'
import EmailCard from '@/components/cards/EmailCard.vue'
import Button from '@/components/ui/button/Button.vue'
import { groupByDate } from '@/utils/dateGroups.js'
import { useStoredSetting } from '@/composables/useStoredSetting.js'
import { showToast } from '@/composables/useToast.js'

const router = useRouter()
const emails = ref([])
const search = ref('')
const favouritesOnly = ref(false)
const deleteMode = ref(false)
const selectedIds = ref(new Set())
const { value: saverEnabled } = useStoredSetting('_emailSaverEnabled', false, (v) => v === true)

function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (raw) => {
      emails.value = Object.entries(raw || {})
        .filter(([k, v]) => k.startsWith('email_') && v?.assetId != null)
        .map(([, v]) => ({
          id: v.id,
          assetId: v.assetId,
          name: v.name,
          subject: v.subject || '',
          status: v.status || '',
          assetTypeDisplayName: v.assetTypeDisplayName || '',
          categoryName: v.categoryName || '',
          timeStamp: v.versions?.[0]?.savedAt || v.timeStamp,
          ownerName: v.ownerName || '',
          isFavourite: !!v.isFavourite,
          compileAsset: v.compileAsset || null,
          versionCount: v.versions?.length || 1,
        }))
        .sort((a, b) => b.timeStamp - a.timeStamp)
      resolve()
    })
  })
}

let reloadTimer = null
function onStorageChange(changes, area) {
  if (area !== 'local' || !Object.keys(changes).some((k) => k.startsWith('email_'))) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(loadData, 300)
}
onMounted(() => { loadData(); chrome.storage.onChanged.addListener(onStorageChange) })
onUnmounted(() => chrome.storage.onChanged.removeListener(onStorageChange))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return emails.value.filter((e) => (!favouritesOnly.value || e.isFavourite) &&
    (!q || [e.name, e.subject, e.categoryName, String(e.assetId)].some((x) => (x || '').toLowerCase().includes(q))))
})
const groups = computed(() => groupByDate(filtered.value))
const visibleIds = computed(() => filtered.value.map((e) => e.id))

async function toggleFavourite(id) {
  const e = emails.value.find((x) => x.id === id)
  const data = await new Promise((r) => chrome.storage.local.get(id, r))
  if (!e || !data[id]) return
  e.isFavourite = !e.isFavourite
  chrome.storage.local.set({ [id]: { ...data[id], isFavourite: e.isFavourite } })
}

function toggleDeleteMode() { deleteMode.value = !deleteMode.value; selectedIds.value = new Set() }
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
  toggleDeleteMode()
  showToast(`Deleted ${ids.length} ${ids.length === 1 ? 'email' : 'emails'} from Marketing Cloud Toolkit.`)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <template v-if="!deleteMode">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="search" type="search" placeholder="Search name, subject, folder or asset ID"
            class="h-8 w-72 rounded-md border border-border bg-background pl-7 pr-2 text-xs" @keyup.esc="search = ''" />
        </div>
        <button class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium"
          :class="favouritesOnly ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400' : 'border-border text-muted-foreground hover:bg-accent'"
          :aria-pressed="favouritesOnly" @click="favouritesOnly = !favouritesOnly">
          <Star class="h-3.5 w-3.5" :fill="favouritesOnly ? 'currentColor' : 'none'" /> Favourites
        </button>
        <div class="flex-1" />
        <span class="text-xs" :class="saverEnabled ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'">
          {{ saverEnabled ? 'Saving new versions' : 'Saving versions is off' }}
        </span>
        <Button variant="ghost" size="icon" class="h-8 w-8" title="Email settings" @click="router.push('/settings')"><SettingsIcon class="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" class="h-8 w-8 hover:text-red-600" title="Select emails to delete" :disabled="!emails.length" @click="toggleDeleteMode"><Trash2 class="h-4 w-4" /></Button>
      </template>
      <template v-else>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" :checked="selectedIds.size > 0 && selectedIds.size === visibleIds.length"
            :indeterminate="selectedIds.size > 0 && selectedIds.size < visibleIds.length" @change="toggleSelectAll" />
          Select all shown ({{ visibleIds.length }})
        </label>
        <span class="text-xs text-muted-foreground">Deletes the saved versions here only, not the emails in Content Builder.</span>
        <div class="flex-1" />
        <Button variant="destructive" size="sm" class="h-8 text-xs" :disabled="!selectedIds.size" @click="deleteSelected"><Trash2 class="h-3.5 w-3.5 mr-1" /> Delete ({{ selectedIds.size }})</Button>
        <Button variant="outline" size="sm" class="h-8 text-xs" @click="toggleDeleteMode"><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
      </template>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-6">
      <div v-if="!emails.length" class="flex flex-col items-center gap-3 py-16 text-center">
        <p class="text-lg font-semibold">No emails saved yet</p>
        <p class="text-sm text-muted-foreground max-w-sm">
          Save an email in Content Builder and it appears here, with every version you save after that.
          <template v-if="!saverEnabled"> Saving versions is turned off in Settings.</template>
        </p>
      </div>
      <div v-else-if="!groups.length" class="flex flex-col items-center gap-3 py-12 text-center">
        <p class="text-sm font-semibold">Nothing matches</p>
        <button class="text-xs text-primary underline" @click="search = ''; favouritesOnly = false">Clear filters</button>
      </div>
      <section v-for="group in groups" :key="group.key" class="mb-7">
        <div class="flex items-center gap-2 mb-3">
          <h2 class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{{ group.label }}</h2>
          <span class="text-[11px] text-muted-foreground bg-muted rounded-full px-2 tabular-nums">{{ group.items.length }}</span>
          <div class="flex-1 h-px bg-border" />
        </div>
        <div class="flex flex-wrap gap-4 items-start">
          <EmailCard v-for="e in group.items" :key="e.id" v-bind="e" :delete-mode="deleteMode" :is-selected="selectedIds.has(e.id)"
            @toggle-select="toggleSelect" @toggle-favourite="toggleFavourite" @open="router.push(`/emails/${encodeURIComponent($event)}`)" />
        </div>
      </section>
    </div>
  </div>
</template>
