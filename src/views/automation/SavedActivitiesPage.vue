<script setup>
// SQL Query and Script activities saved in Automation Studio, with every version the
// service worker captured (feedback #122; background/activityCapture.js). The list at
// /saved-activities, one activity at /saved-activities/<record key>: its versions, the
// code, the changes against the version before, Copy, Open in Run Query and Restore.
// Below the list, "Not seeing your saves?" shows the last Automation Studio requests
// that write (feedback #129), kept by the service worker in chrome.storage.session.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Search, ArrowLeft, Clock, Copy, Play, RotateCcw, Trash2, AlertCircle, Check, Loader2, Settings as SettingsIcon, ExternalLink,
} from 'lucide-vue-next'
import CodeView from '@/components/results/CodeView.vue'
import { useStoredSetting } from '@/composables/useStoredSetting.js'
import { showToast } from '@/composables/useToast.js'
import { sfmcFetch, logInfo } from '@/utils/sfmcApi.js'
import {
  ACTIVITY_SAVER_SETTING, activityKindLabel, isActivityKey, searchRecords, sideBySideDiff, activityUrl, restoreBody,
  isBadActivityKey,
} from '@/utils/activityVersions.js'

const route = useRoute()
const router = useRouter()
const { value: saverEnabled } = useStoredSetting(ACTIVITY_SAVER_SETTING, false, (v) => v === true)

const records = ref([])
const loaded = ref(false)
const search = ref('')

function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (raw) => {
      // Records made from a non-id path word such as .../scripts/validate (feedback #130).
      const bad = Object.keys(raw || {}).filter(isBadActivityKey)
      if (bad.length) chrome.storage.local.remove(bad)
      records.value = Object.entries(raw || {})
        .filter(([k, v]) => isActivityKey(k) && !isBadActivityKey(k) && Array.isArray(v?.versions) && v.versions.length)
        .map(([, v]) => v)
      loaded.value = true
      resolve()
    })
  })
}
let reloadTimer = null
function onStorageChange(changes, area) {
  if (area !== 'local' || !Object.keys(changes).some(isActivityKey)) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(loadData, 300)
}

onMounted(() => {
  loadData()
  chrome.storage.onChanged.addListener(onStorageChange)
})
onUnmounted(() => chrome.storage.onChanged.removeListener(onStorageChange))

const shown = computed(() => searchRecords(records.value, search.value))

// ── One activity ───────────────────────────────────────────
const recordId = computed(() => (route.params.id ? String(route.params.id) : ''))
const record = computed(() => records.value.find((r) => r.id === recordId.value) || null)
const versions = computed(() => record.value?.versions || [])
const selectedIdx = ref(0)
const view = ref('code') // code | changes
watch(recordId, () => { selectedIdx.value = 0; view.value = 'code'; restoreState.value = 'idle' })
const selected = computed(() => versions.value[selectedIdx.value] || null)
const older = computed(() => versions.value[selectedIdx.value + 1] || null)
const diffRows = computed(() => (selected.value && older.value ? sideBySideDiff(older.value.content, selected.value.content) : []))
const changedCount = computed(() => diffRows.value.filter((r) => r.type !== 'same').length)
const lang = computed(() => (record.value?.kind === 'script' ? 'javascript' : 'sql'))

const label = (v) => `v${versions.value.length - versions.value.indexOf(v)}`
function formatDate(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const sourceLabel = (v) => (v.source === 'before-save' ? 'Before an edit' : 'Saved')

async function copy() {
  try { await navigator.clipboard.writeText(selected.value?.content || ''); showToast('Copied.') } catch { showToast('Could not copy.') }
}
function openInRunQuery() {
  router.push({ path: '/queries/workspace', query: { sql: selected.value?.content || '' } })
}

// Restore: the activity as SFMC has it now, with this version's SQL or script.
const restoreState = ref('idle') // idle | confirm | pending | done | { error }
async function restore() {
  const r = record.value
  const v = selected.value
  const stack = v?.stack || r?.stack
  if (!r || !v || !stack) return
  restoreState.value = 'pending'
  const url = activityUrl(r.kind, stack, r.activityId)
  logInfo(`Restoring ${activityKindLabel(r.kind)} "${r.name}" to ${label(v)} (saved ${formatDate(v.savedAt)})`)
  try {
    const current = await sfmcFetch(url, 'GET')
    await sfmcFetch(url, 'PATCH', restoreBody(r.kind, current, v))
    restoreState.value = 'done'
    showToast(`Restored ${label(v)}. Reopen the activity in Automation Studio to see it.`, 6000)
  } catch (e) {
    restoreState.value = { error: e.message }
  }
}

async function deleteVersion(v) {
  const r = record.value
  if (!r) return
  const remaining = versions.value.filter((x) => x.versionId !== v.versionId)
  if (!remaining.length) {
    if (!confirm('This is the last version. Delete this activity from Marketing Cloud Toolkit? (Nothing changes in Automation Studio.)')) return
    await new Promise((res) => chrome.storage.local.remove(r.id, res))
    router.push('/saved-activities')
  } else {
    await new Promise((res) => chrome.storage.local.set({ [r.id]: { ...r, versions: remaining } }, res))
    if (selectedIdx.value >= remaining.length) selectedIdx.value = remaining.length - 1
  }
  await loadData()
}

const automationStudioUrl = (stack) => `https://mc.${stack}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- List -->
    <template v-if="!recordId">
      <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="search" type="search" placeholder="Search name, key, target, SQL or script"
            aria-label="Search saved activities" class="h-8 w-80 rounded-md border border-border bg-background pl-7 pr-2 text-xs" @keyup.esc="search = ''" />
        </div>
        <div class="flex-1" />
        <span class="text-xs" :class="saverEnabled ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'">
          {{ saverEnabled ? 'Saving new versions' : 'Saving versions is off' }}
        </span>
        <button class="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent" title="Settings" @click="router.push('/settings')"><SettingsIcon class="h-4 w-4" /></button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-6">
        <div v-if="loaded && !records.length" class="flex flex-col items-center gap-3 py-16 text-center">
          <p class="text-lg font-semibold">No activities saved yet</p>
          <p class="text-sm text-muted-foreground max-w-md">
            Save a SQL Query or Script activity in Automation Studio and it appears here, with the version from before
            your edit and every version you save after that.
            <template v-if="!saverEnabled"> Saving versions is turned off in Settings.</template>
          </p>
        </div>
        <p v-else-if="loaded && !shown.length" class="text-sm text-muted-foreground">Nothing matches.</p>
        <ul v-else class="divide-y divide-border rounded-lg border border-border bg-card">
          <li v-for="r in shown" :key="r.id">
            <RouterLink :to="`/saved-activities/${r.id}`" class="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
              <span class="text-[10px] font-semibold uppercase tracking-wide text-primary w-20 shrink-0">{{ activityKindLabel(r.kind) }}</span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium truncate">{{ r.name || r.activityId }}</span>
                <span class="block text-[11px] text-muted-foreground truncate">
                  <template v-if="r.versions[0].targetName">Target {{ r.versions[0].targetName }} · </template>
                  <template v-if="r.businessUnit?.name">{{ r.businessUnit.name }} · </template>{{ r.stack }}
                </span>
              </span>
              <span class="text-[11px] text-muted-foreground tabular-nums shrink-0">{{ r.versions.length }} {{ r.versions.length === 1 ? 'version' : 'versions' }}</span>
              <span class="text-[11px] text-muted-foreground shrink-0 w-36 text-right">{{ formatDate(r.versions[0].savedAt) }}</span>
            </RouterLink>
          </li>
        </ul>

      </div>
    </template>

    <!-- One activity -->
    <template v-else>
      <div v-if="loaded && !record" class="flex-1 flex flex-col items-center justify-center gap-3">
        <AlertCircle class="h-10 w-10 text-muted-foreground/40" />
        <p class="text-sm text-muted-foreground">This activity has no saved versions in Marketing Cloud Toolkit.</p>
        <RouterLink to="/saved-activities" class="text-xs text-primary underline">Back to saved activities</RouterLink>
      </div>
      <template v-else-if="record">
        <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
          <RouterLink to="/saved-activities" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Back to saved activities"><ArrowLeft class="h-4 w-4" /></RouterLink>
          <div class="flex-1 min-w-0">
            <h1 class="text-sm font-semibold truncate">{{ record.name || record.activityId }}</h1>
            <div class="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
              <span>{{ activityKindLabel(record.kind) }}</span>
              <span v-if="record.key">Key {{ record.key }}</span>
              <span v-if="record.businessUnit?.name">{{ record.businessUnit.name }}</span>
              <span>{{ record.stack }}</span>
            </div>
          </div>
          <span class="text-[11px] font-medium bg-muted border border-border rounded-full px-2.5 py-0.5 text-muted-foreground">
            {{ versions.length }} {{ versions.length === 1 ? 'version' : 'versions' }}
          </span>
        </div>

        <div class="flex-1 flex min-h-0">
          <aside class="w-72 shrink-0 border-r border-border bg-card flex flex-col min-h-0" aria-label="Versions">
            <div class="px-4 py-2 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Version history</div>
            <div class="flex-1 overflow-y-auto">
              <div v-for="(v, idx) in versions" :key="v.versionId"
                class="border-b border-border last:border-0 border-l-2 cursor-pointer px-4 py-3"
                :class="selectedIdx === idx ? 'bg-primary/5 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'"
                :aria-current="selectedIdx === idx" @click="selectedIdx = idx; restoreState = 'idle'">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-bold">{{ label(v) }}</span>
                  <span v-if="idx === 0" class="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-full px-1.5">Latest</span>
                  <span class="text-[9px] text-muted-foreground border border-border rounded-full px-1.5">{{ sourceLabel(v) }}</span>
                  <button class="ml-auto p-1 rounded text-muted-foreground/50 hover:text-red-500" title="Delete this version" @click.stop="deleteVersion(v)"><Trash2 class="h-3 w-3" /></button>
                </div>
                <div class="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock class="h-2.5 w-2.5" /> {{ formatDate(v.savedAt) }}</div>
                <p v-if="v.targetName" class="text-[10px] text-muted-foreground mt-1 truncate">Target {{ v.targetName }}<template v-if="v.targetUpdateType"> ({{ v.targetUpdateType }})</template></p>
              </div>
            </div>
          </aside>

          <section v-if="selected" class="flex-1 flex flex-col min-w-0" aria-label="Version">
            <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card text-xs">
              <span class="font-semibold">{{ label(selected) }}</span>
              <span class="text-muted-foreground">{{ formatDate(selected.savedAt) }}</span>
              <div class="inline-flex rounded-md border border-border overflow-hidden ml-2" role="tablist">
                <button role="tab" :aria-selected="view === 'code'" class="px-2.5 py-1" :class="view === 'code' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent'" @click="view = 'code'">{{ record.kind === 'script' ? 'Script' : 'SQL' }}</button>
                <button role="tab" :aria-selected="view === 'changes'" :disabled="!older" class="px-2.5 py-1 disabled:opacity-50" :class="view === 'changes' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent'"
                  :title="older ? `Changes from ${label(older)}` : 'This is the oldest version'" @click="view = 'changes'">Changes</button>
              </div>
              <div class="flex-1" />
              <button class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-accent" @click="copy"><Copy class="h-3 w-3" /> Copy</button>
              <button v-if="record.kind === 'query'" class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-accent" @click="openInRunQuery"><Play class="h-3 w-3" /> Open in Run Query</button>
              <button v-if="restoreState === 'idle' || restoreState === 'done'" class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary/10"
                @click="restoreState = 'confirm'"><RotateCcw class="h-3 w-3" /> Restore this version</button>
            </div>

            <div v-if="restoreState === 'confirm'" class="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-200" role="alertdialog">
              <p>Replace the {{ record.kind === 'script' ? 'script' : 'SQL' }} of "{{ record.name }}" in Automation Studio with {{ label(selected) }}? The activity is not run. Its current text is kept here when the change is saved.</p>
              <div class="flex gap-2 mt-2">
                <button class="rounded bg-primary text-primary-foreground px-3 py-1 font-semibold" @click="restore">Restore</button>
                <button class="rounded border border-border bg-background px-3 py-1" @click="restoreState = 'idle'">Cancel</button>
              </div>
            </div>
            <div v-else-if="restoreState === 'pending'" class="mx-4 mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Restoring…</div>
            <div v-else-if="restoreState === 'done'" class="mx-4 mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Check class="h-3 w-3" /> Restored in Automation Studio.</div>
            <div v-else-if="restoreState?.error" class="mx-4 mt-3 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2" role="alert">
              <AlertCircle class="h-3.5 w-3.5 shrink-0 mt-px" />
              <span class="flex-1 wrap-break-word">Could not restore: {{ restoreState.error }}
                <a :href="automationStudioUrl(selected.stack || record.stack)" target="_blank" rel="noopener" class="underline inline-flex items-center gap-0.5 ml-1">Open Automation Studio <ExternalLink class="h-2.5 w-2.5" /></a>
              </span>
              <button class="underline" @click="restoreState = 'idle'">Close</button>
            </div>

            <div class="flex-1 min-h-0 overflow-auto p-4">
              <CodeView v-if="view === 'code'" :key="selected.versionId" :code="selected.content" :lang="lang" max-height="none" />
              <template v-else>
                <p class="text-[11px] text-muted-foreground mb-2">{{ label(older) }} on the left, {{ label(selected) }} on the right. {{ changedCount }} {{ changedCount === 1 ? 'line differs' : 'lines differ' }}.</p>
                <div class="rounded-md border border-border overflow-auto font-mono text-[11px] leading-5" aria-label="Changes">
                  <div v-for="(row, i) in diffRows" :key="i" class="grid grid-cols-2">
                    <pre class="px-2 whitespace-pre-wrap break-all border-r border-border"
                      :class="row.type === 'removed' || row.type === 'changed' ? 'bg-red-50 dark:bg-red-950/40' : ''">{{ row.left ?? '' }}</pre>
                    <pre class="px-2 whitespace-pre-wrap break-all"
                      :class="row.type === 'added' || row.type === 'changed' ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''">{{ row.right ?? '' }}</pre>
                  </div>
                </div>
              </template>
            </div>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>
