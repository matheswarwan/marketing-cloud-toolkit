<script setup>
// Automation overview (feedback #50): every automation in the business unit counted
// by status and last run, what needs a look, watched automations, and run trends
// from the run log on request.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Loader2, RefreshCw, TrendingUp, Eye } from 'lucide-vue-next'
import StatusBadge from '@/components/results/StatusBadge.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { isRunningStatus } from '@/utils/runProgress.js'
import StackedBars from '@/components/results/StackedBars.vue'
import Button from '@/components/ui/button/Button.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { listAllAutomations, summarizeAutomations, runTrends } from '@/utils/overview.js'
import { automationStatusName, WATCHES_KEY, watchType } from '@/utils/watches.js'
import { formatDateTime } from '@/utils/format.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import { pageCacheKey, readPageCache, writePageCache, pendingPageCache } from '@/utils/pageCache.js'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { automationOverviewDoc } from '@/utils/overviewDoc.js'

const { stack } = useStack()
// What this page read is kept per stack and business unit, so leaving and coming
// back shows it again (feedback #66). Refresh reads it again.
let cacheKey = ''
const savedAt = ref(0)
const buName = ref('')
async function currentKey() {
  const bu = await fetchCurrentBU(stack.value).catch(() => null)
  buName.value = bu?.name || ''
  return pageCacheKey('automation-overview', stack.value, bu?.accountId)
}
const save = (patch) => { if (cacheKey) savedAt.value = writePageCache(cacheKey, patch).savedAt }
const list = ref(null)
const loading = ref(false)
const progress = ref({ done: 0, total: 0 })
const error = ref('')
const summary = computed(() => (list.value ? summarizeAutomations(list.value) : null))
const runningNow = computed(() => (list.value || []).filter((a) => isRunningStatus(a.status)))

async function load() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud.'; return }
  loading.value = true
  error.value = ''
  trends.value = null
  pickedDay.value = -1
  try {
    cacheKey = await currentKey()
    list.value = await listAllAutomations(stack.value, (done, total) => { progress.value = { done, total } })
    save({ list: list.value, trends: null })
  } catch (e) {
    error.value = `Could not read the automations: ${e.message}`
  } finally {
    loading.value = false
  }
}

// ── Run trends (on request: one run-log call per automation) ──
const trendDays = ref(30)
const trends = ref(null)
const trendBusy = ref(false)
const trendProgress = ref({ done: 0, total: 0 })
async function loadTrends() {
  trendBusy.value = true
  error.value = ''
  try {
    pickedDay.value = -1
    trends.value = await runTrends(stack.value, list.value, { days: trendDays.value, onProgress: (done, total) => { trendProgress.value = { done, total } } })
    save({ trends: trends.value, trendDays: trendDays.value })
  } catch (e) {
    error.value = `Could not read the run logs: ${e.message}`
  } finally {
    trendBusy.value = false
  }
}
const pickedDay = ref(-1)
const dayRuns = computed(() => (trends.value && pickedDay.value >= 0 ? trends.value.days[pickedDay.value] : null))
const trendTotals = computed(() => trends.value?.days.reduce((t, d) => ({ ok: t.ok + d.ok, failed: t.failed + d.failed }), { ok: 0, failed: 0 }))
const dayLabel = (r) => new Date(`${r.key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const SERIES = [{ key: 'ok', label: 'Succeeded', color: '#0ca30c' }, { key: 'failed', label: 'Failed', color: '#d03b3b' }]

// ── Watched automations ─────────────────────────────────
const watches = ref({})
const watchedHere = computed(() => Object.values(watches.value).filter((w) => w.stack === stack.value && watchType(w) === 'automation'))
const loadWatches = () => chrome.storage.local.get(WATCHES_KEY, (r) => { watches.value = r?.[WATCHES_KEY] || {} })
const onChange = (c, area) => { if (area === 'local' && WATCHES_KEY in c) watches.value = c[WATCHES_KEY].newValue || {} }
onMounted(() => { try { loadWatches(); chrome.storage.onChanged.addListener(onChange) } catch { /* not in an extension */ } })
onUnmounted(() => { try { chrome.storage.onChanged.removeListener(onChange) } catch { /* ignore */ } })
const link = (id) => `/automations/${encodeURIComponent(id)}`

// Download menu (feedback #69): the page as a document to share.
const getDoc = () => automationOverviewDoc({
  businessUnit: buName.value, stack: stack.value, savedAt: savedAt.value,
  summary: summary.value, trends: trends.value, trendDays: trendDays.value, watched: watchedHere.value,
})

// Shows what was read before for this stack and BU, else reads it now.
async function start() {
  if (!stack.value) return load()
  cacheKey = await currentKey()
  // The quiet preload (feedback #78) may be reading it right now: wait for it.
  const pending = pendingPageCache(cacheKey)
  if (pending) {
    loading.value = true
    await pending.catch(() => undefined)
    loading.value = false
  }
  const saved = readPageCache(cacheKey)
  if (!saved?.list) return load()
  list.value = saved.list
  trends.value = saved.trends || null
  if (saved.trendDays) trendDays.value = saved.trendDays
  savedAt.value = saved.savedAt
}
// Last, so everything start() touches is defined when it runs straight away.
whenStack(start)
</script>

<template>
  <div class="h-full overflow-y-auto p-4 space-y-4 text-sm">
    <div class="flex items-center gap-2">
      <h1 class="text-base font-semibold flex-1">Automations in this business unit</h1>
      <ProgressBar v-if="loading" :value="progress.done" :max="progress.total" label="Reading" show-count class="w-56" />
      <span v-else-if="savedAt" class="text-xs text-muted-foreground">Read {{ formatDateTime(new Date(savedAt).toISOString()) }}</span>
      <DownloadMenu :get-doc="getDoc" file-name="automation-overview" :disabled="!summary" />
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loading" @click="load">
        <Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5 mr-1" /> Refresh
      </Button>
    </div>
    <p v-if="error" class="text-red-600 text-xs" role="alert">{{ error }}</p>

    <template v-if="summary">
      <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Automations</div><div class="text-2xl font-semibold tabular-nums">{{ summary.total.toLocaleString() }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Last run failed</div><div class="text-2xl font-semibold tabular-nums" :class="summary.failedLastRun ? 'text-red-600' : ''">{{ summary.failedLastRun }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3 col-span-2">
          <div class="text-xs text-muted-foreground mb-1">By status</div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="s in summary.byStatus" :key="s.label" class="inline-flex items-center gap-1"><StatusBadge :status="s.label" /> <span class="tabular-nums text-xs">{{ s.count }}</span></span>
          </div>
        </div>
      </section>

      <section v-if="runningNow.length" class="rounded-lg border border-border bg-card p-3">
        <h2 class="font-semibold mb-2">Running when read <span class="text-xs font-normal text-muted-foreground">({{ runningNow.length }})</span></h2>
        <ul class="space-y-1.5 text-xs">
          <li v-for="a in runningNow" :key="a.id" class="flex items-center gap-3">
            <RouterLink :to="link(a.id)" class="font-medium hover:underline truncate max-w-80">{{ a.name }}</RouterLink>
            <ProgressBar indeterminate size="xs" aria-label="Running" class="w-32" />
            <span class="text-muted-foreground whitespace-nowrap">since {{ formatDateTime(a.lastRunTime) }}</span>
          </li>
        </ul>
      </section>

      <section class="rounded-lg border border-border bg-card p-3">
        <h2 class="font-semibold mb-2">Needs a look <span class="text-xs font-normal text-muted-foreground">({{ summary.attention.length }})</span></h2>
        <p v-if="!summary.attention.length" class="text-xs text-muted-foreground">Nothing: no failed last runs, no automations in error, none running for more than 6 hours.</p>
        <table v-else class="w-full text-xs">
          <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Automation</th><th class="py-1 pr-3">Status</th><th class="py-1 pr-3">Why</th><th class="py-1 pr-3">Last run</th></tr></thead>
          <tbody><tr v-for="x in summary.attention" :key="x.automation.id" class="border-b border-border/50">
            <td class="py-1 pr-3"><RouterLink :to="link(x.automation.id)" class="font-medium hover:underline">{{ x.automation.name }}</RouterLink></td>
            <td class="py-1 pr-3"><StatusBadge :status="automationStatusName(x.automation.status)" /></td>
            <td class="py-1 pr-3">{{ x.reason }}</td>
            <td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(x.automation.lastRunTime) }}</td>
          </tr></tbody>
        </table>
      </section>

      <section class="rounded-lg border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-semibold flex-1">Run trends</h2>
          <select v-model.number="trendDays" class="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="Days of runs">
            <option :value="7">Last 7 days</option><option :value="30">Last 30 days</option><option :value="90">Last 90 days</option>
          </select>
          <Button size="sm" variant="outline" class="h-7 text-xs" :disabled="trendBusy" @click="loadTrends">
            <Loader2 v-if="trendBusy" class="h-3.5 w-3.5 mr-1 animate-spin" /><TrendingUp v-else class="h-3.5 w-3.5 mr-1" />
            {{ trendBusy ? `Reading run logs ${trendProgress.done} of ${trendProgress.total}` : trends ? 'Load again' : 'Load run trends' }}
          </Button>
        </div>
        <ProgressBar v-if="trendBusy" :value="trendProgress.done" :max="trendProgress.total" aria-label="Reading run logs" class="mb-2" />
        <p v-if="!trends" class="text-xs text-muted-foreground">Runs of every automation in this business unit, not only watched ones: reads the run log of the 40 that ran most recently in the period (one request each), then shows runs and failures per day.</p>
        <template v-else>
          <p class="text-xs text-muted-foreground mb-2">{{ trendTotals.ok + trendTotals.failed }} runs, {{ trendTotals.failed }} failed, across {{ trends.read }} automations (all automations that ran, not only watched ones){{ trends.errors ? `; ${trends.errors} run logs could not be read` : '' }}. Click a day to see its runs.<template v-if="trends.partialDays?.length"> {{ trends.partialDays.length === 1 ? 'One day' : `${trends.partialDays.length} days` }} ({{ trends.partialDays.join(', ') }}) had more than 200 runs of one automation; those days show the newest 200 of it.</template></p>
          <StackedBars :rows="trends.days" :series="SERIES" :label-of="dayLabel" :title="`Runs per day, last ${trendDays} days`" :selected="pickedDay" @select="pickedDay = pickedDay === $event ? -1 : $event" />
          <div v-if="dayRuns" class="mt-3">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-xs font-semibold flex-1">Runs on {{ dayLabel(dayRuns) }} ({{ dayRuns.runs.length }})</h3>
              <button class="text-xs text-muted-foreground hover:underline" @click="pickedDay = -1">Close</button>
            </div>
            <p v-if="!dayRuns.runs.length" class="text-xs text-muted-foreground">No runs that day.</p>
            <table v-else class="w-full text-xs">
              <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Automation</th><th class="py-1 pr-3">Started</th><th class="py-1 pr-3">Result</th></tr></thead>
              <tbody><tr v-for="(r, i) in dayRuns.runs" :key="i" class="border-b border-border/50">
                <td class="py-1 pr-3"><RouterLink :to="link(r.automation.id)" class="font-medium hover:underline">{{ r.automation.name }}</RouterLink></td>
                <td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(r.start) }}</td>
                <td class="py-1 pr-3"><StatusBadge :status="r.status || (r.failed ? 'Error' : 'Complete')" /> <span v-if="r.message" class="text-muted-foreground">{{ r.message }}</span></td>
              </tr></tbody>
            </table>
          </div>
          <table class="w-full text-xs mt-3">
            <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Automation (most failures first)</th><th class="py-1 pr-3 text-right">Runs</th><th class="py-1 pr-3 text-right">Failed</th><th class="py-1 pr-3">Last run</th><th class="py-1 pr-3">Last failure</th></tr></thead>
            <tbody><tr v-for="p in trends.perAutomation.filter((x) => x.runs)" :key="p.automation.id" class="border-b border-border/50">
              <td class="py-1 pr-3"><RouterLink :to="link(p.automation.id)" class="font-medium hover:underline">{{ p.automation.name }}</RouterLink></td>
              <td class="py-1 pr-3 text-right tabular-nums">{{ p.runs }}</td><td class="py-1 pr-3 text-right tabular-nums" :class="p.failed ? 'text-red-600' : 'text-muted-foreground'">{{ p.failed }}</td>
              <td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(p.lastRun?.start) }}</td>
              <td class="py-1 pr-3">{{ p.lastFailure ? `${formatDateTime(p.lastFailure.start)} ${p.lastFailure.message || ''}` : '—' }}</td>
            </tr></tbody>
          </table>
        </template>
      </section>
    </template>

    <section class="rounded-lg border border-border bg-card p-3">
      <h2 class="font-semibold mb-2 flex items-center gap-1.5"><Eye class="h-4 w-4" /> Watched here <span class="text-xs font-normal text-muted-foreground">({{ watchedHere.length }})</span></h2>
      <p v-if="!watchedHere.length" class="text-xs text-muted-foreground">Open an automation and click Watch to be told when it is paused, activated, runs or fails.</p>
      <table v-else class="w-full text-xs">
        <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Automation</th><th class="py-1 pr-3">Status</th><th class="py-1 pr-3">Last run</th><th class="py-1 pr-3">Checked</th></tr></thead>
        <tbody><tr v-for="w in watchedHere" :key="w.id" class="border-b border-border/50">
          <td class="py-1 pr-3"><RouterLink :to="link(w.id)" class="font-medium hover:underline">{{ w.name }}</RouterLink></td>
          <td class="py-1 pr-3"><StatusBadge :status="automationStatusName(w.last?.status)" /></td>
          <td class="py-1 pr-3">{{ formatDateTime(w.last?.lastRunTime) }} {{ w.last?.lastRunStatus || '' }}</td>
          <td class="py-1 pr-3 text-muted-foreground">{{ w.checkedAt ? formatDateTime(new Date(w.checkedAt).toISOString()) : 'Not yet' }}<span v-if="w.error" class="block text-red-600">{{ w.error }}</span></td>
        </tr></tbody>
      </table>
    </section>
  </div>
</template>
