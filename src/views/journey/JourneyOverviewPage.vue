<script setup>
// Journey overview (feedback #50): journeys counted by status, and on request what
// each live journey sends (email, SMS, push), read from its definition.
import { computed, ref } from 'vue'
import { Loader2, RefreshCw, Mail } from 'lucide-vue-next'
import StatusBadge from '@/components/results/StatusBadge.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import Button from '@/components/ui/button/Button.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { listAllJourneys, summarizeJourneys, journeyChannels } from '@/utils/overview.js'
import { formatDateTime } from '@/utils/format.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import { pageCacheKey, readPageCache, writePageCache, pendingPageCache } from '@/utils/pageCache.js'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { journeyOverviewDoc } from '@/utils/overviewDoc.js'

const { stack } = useStack()
// Kept per stack and business unit like the Automation overview (feedback #66).
let cacheKey = ''
const savedAt = ref(0)
const buName = ref('')
async function currentKey() {
  const bu = await fetchCurrentBU(stack.value).catch(() => null)
  buName.value = bu?.name || ''
  return pageCacheKey('journey-overview', stack.value, bu?.accountId)
}
const save = (patch) => { if (cacheKey) savedAt.value = writePageCache(cacheKey, patch).savedAt }
const list = ref(null)
const loading = ref(false)
const progress = ref({ done: 0, total: 0 })
const error = ref('')
const summary = computed(() => (list.value ? summarizeJourneys(list.value) : null))

async function load() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud.'; return }
  loading.value = true
  error.value = ''
  sends.value = null
  try {
    cacheKey = await currentKey()
    list.value = await listAllJourneys(stack.value, (done, total) => { progress.value = { done, total } })
    save({ list: list.value, sends: null })
  } catch (e) {
    error.value = `Could not read the journeys: ${e.message}`
  } finally {
    loading.value = false
  }
}

const sends = ref(null)
const sendBusy = ref(false)
const sendProgress = ref({ done: 0, total: 0 })
async function loadSends() {
  sendBusy.value = true
  error.value = ''
  try {
    sends.value = await journeyChannels(stack.value, list.value, { onProgress: (done, total) => { sendProgress.value = { done, total } } })
    save({ sends: sends.value })
  } catch (e) {
    error.value = `Could not read the journeys' definitions: ${e.message}`
  } finally {
    sendBusy.value = false
  }
}
const totals = computed(() => (sends.value ? ['email', 'sms', 'push', 'whatsapp'].map((k) => [k, sends.value.rows.filter((r) => r[k].length).length]) : []))
const CH = { email: 'Email', sms: 'SMS', push: 'Push / in-app', whatsapp: 'WhatsApp' }
// Download menu (feedback #69): the page as a document to share.
const getDoc = () => journeyOverviewDoc({ businessUnit: buName.value, stack: stack.value, savedAt: savedAt.value, summary: summary.value, sends: sends.value })
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
  sends.value = saved.sends || null
  savedAt.value = saved.savedAt
}
// Last, so everything start() touches is defined when it runs straight away.
whenStack(start)
</script>

<template>
  <div class="h-full overflow-y-auto p-4 space-y-4 text-sm">
    <div class="flex items-center gap-2">
      <h1 class="text-base font-semibold flex-1">Journeys in this business unit</h1>
      <ProgressBar v-if="loading" :value="progress.done" :max="progress.total" label="Reading" show-count class="w-56" />
      <span v-else-if="savedAt" class="text-xs text-muted-foreground">Read {{ formatDateTime(new Date(savedAt).toISOString()) }}</span>
      <DownloadMenu :get-doc="getDoc" file-name="journey-overview" :disabled="!summary" />
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="loading" @click="load">
        <Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5 mr-1" /> Refresh
      </Button>
    </div>
    <p v-if="error" class="text-red-600 text-xs" role="alert">{{ error }}</p>

    <template v-if="summary">
      <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Journeys</div><div class="text-2xl font-semibold tabular-nums">{{ summary.total.toLocaleString() }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3"><div class="text-xs text-muted-foreground">Live (published or scheduled)</div><div class="text-2xl font-semibold tabular-nums">{{ summary.live }}</div></div>
        <div class="rounded-lg border border-border bg-card p-3 col-span-2">
          <div class="text-xs text-muted-foreground mb-1">By status</div>
          <div class="flex flex-wrap gap-1.5"><span v-for="s in summary.byStatus" :key="s.label" class="inline-flex items-center gap-1"><StatusBadge :status="s.label" /> <span class="tabular-nums text-xs">{{ s.count }}</span></span></div>
        </div>
      </section>

      <section class="rounded-lg border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-semibold flex-1">What live journeys send</h2>
          <Button size="sm" variant="outline" class="h-7 text-xs" :disabled="sendBusy || !summary.live" @click="loadSends">
            <Loader2 v-if="sendBusy" class="h-3.5 w-3.5 mr-1 animate-spin" /><Mail v-else class="h-3.5 w-3.5 mr-1" />
            {{ sendBusy ? `Reading ${sendProgress.done} of ${sendProgress.total}` : sends ? 'Read again' : 'Find what they send' }}
          </Button>
        </div>
        <ProgressBar v-if="sendBusy" :value="sendProgress.done" :max="sendProgress.total" aria-label="Reading live journeys" class="mb-2" />
        <p v-if="!sends" class="text-xs text-muted-foreground">Reads each live journey's definition (up to 100, one request each) and lists the emails, SMS and push messages in it.</p>
        <template v-else>
          <p class="text-xs mb-2">
            <span v-for="[k, n] in totals" :key="k" class="mr-3"><strong class="tabular-nums">{{ n }}</strong> <span class="text-muted-foreground">send {{ CH[k] }}</span></span>
            <span class="text-muted-foreground">of {{ sends.checked }} live journeys.</span>
          </p>
          <table class="w-full text-xs">
            <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1 pr-3">Journey</th><th class="py-1 pr-3">Status</th><th class="py-1 pr-3">Email</th><th class="py-1 pr-3">SMS</th><th class="py-1 pr-3">Push / in-app</th><th class="py-1 pr-3">Modified</th></tr></thead>
            <tbody><tr v-for="r in sends.rows" :key="r.journey.id" class="border-b border-border/50 align-top">
              <td class="py-1 pr-3"><RouterLink :to="`/journeys/${encodeURIComponent(r.journey.id)}`" class="font-medium hover:underline">{{ r.journey.name }}</RouterLink><span v-if="r.error" class="block text-red-600">{{ r.error }}</span></td>
              <td class="py-1 pr-3"><StatusBadge :status="r.journey.status" /></td>
              <td class="py-1 pr-3">{{ r.email.join(', ') || '—' }}</td>
              <td class="py-1 pr-3">{{ r.sms.join(', ') || '—' }}</td>
              <td class="py-1 pr-3">{{ r.push.join(', ') || '—' }}</td>
              <td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(r.journey.modifiedDate) }}</td>
            </tr></tbody>
          </table>
        </template>
      </section>
    </template>
  </div>
</template>
