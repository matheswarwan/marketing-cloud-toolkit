<script setup>
// An automation's run history (feedback #41), from the same requests as Automation
// Studio's run log. Loads when opened; each run can show its raw record, since the
// response fields are read by their likely names.
import { ref, watch } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import StatusBadge from '@/components/results/StatusBadge.vue'
import CodeView from '@/components/results/CodeView.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { fetchRunHistory, fetchAutomationHealth, fetchWorkerInstance } from '@/utils/automationApi.js'
import { formatDateTime } from '@/utils/format.js'

const props = defineProps({
  stack: { type: String, default: null },
  automationId: { type: String, required: true },
  refreshKey: { type: Number, default: 0 }, // bumped when a run ends (feedback #123)
})

const open = ref(false)
const days = ref(30)
const top = ref(50)
const loading = ref(false)
const error = ref('')
const runs = ref(null)
const total = ref(0)
const health = ref(null)
const expanded = ref(new Set())

async function load() {
  if (!props.stack) { error.value = 'Not connected to Marketing Cloud.'; return }
  loading.value = true
  error.value = ''
  try {
    const [r, h] = await Promise.all([
      fetchRunHistory(props.stack, props.automationId, { days: days.value, top: top.value }),
      fetchAutomationHealth(props.stack, props.automationId).catch(() => null),
    ])
    runs.value = r.runs
    total.value = r.total
    health.value = h && typeof h === 'object' ? Object.entries(h).filter(([, v]) => v != null && typeof v !== 'object') : null
  } catch (e) {
    error.value = `Could not load the run history: ${e.message}`
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  if (open.value && runs.value === null) load()
}
watch(() => props.refreshKey, () => { if (open.value) load() })
watch(days, () => { top.value = 50; if (open.value) load() })
function more() { top.value += 50; load() }
function toggleRaw(i) {
  const next = new Set(expanded.value)
  next.has(i) ? next.delete(i) : next.add(i)
  expanded.value = next
}
// A failed step's worker instance (feedback #157): SFMC's run record often says only
// "Error has occurred"; the worker may say why.
const workers = ref({}) // workerUrl -> { busy, message, raw, error }
async function loadWorker(url) {
  workers.value = { ...workers.value, [url]: { busy: true } }
  try { workers.value = { ...workers.value, [url]: await fetchWorkerInstance(props.stack, url) } }
  catch (e) { workers.value = { ...workers.value, [url]: { error: e.message } } }
}
const duration = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`)
const label = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
</script>

<template>
  <section class="rounded-lg border border-border bg-card">
    <button class="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-semibold" :aria-expanded="open" @click="toggle">
      <ChevronDown v-if="open" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /> Run history
      <span v-if="runs" class="font-normal text-xs text-muted-foreground">({{ runs.length }}{{ total > runs.length ? ` of ${total}` : '' }}, last {{ days }} days)</span>
    </button>
    <div v-if="open" class="px-3 pb-3 space-y-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1.5">Last
          <select v-model.number="days" class="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="Days of history">
            <option :value="7">7 days</option><option :value="30">30 days</option><option :value="90">90 days</option><option :value="180">180 days</option>
          </select>
        </label>
        <button class="h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-50" :disabled="loading" @click="load">Refresh</button>
        <ProgressBar v-if="loading" indeterminate size="xs" aria-label="Reading the run history" class="w-24" />
        <span v-for="[k, v] in health || []" :key="k" class="rounded-full border border-border px-2 py-0.5 text-muted-foreground">{{ label(k) }}: <span class="text-foreground">{{ v }}</span></span>
      </div>
      <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
      <div v-if="runs" class="overflow-x-auto">
        <table class="w-full">
          <thead><tr class="text-left text-muted-foreground border-b border-border">
            <th class="py-1.5 pr-3 font-semibold">Started</th><th class="py-1.5 pr-3 font-semibold">Ended</th><th class="py-1.5 pr-3 font-semibold">Took</th>
            <th class="py-1.5 pr-3 font-semibold">Status</th><th class="py-1.5 pr-3 font-semibold">Message</th><th />
          </tr></thead>
          <tbody>
            <template v-for="(r, i) in runs" :key="r.id || i">
              <tr class="border-b border-border/50 align-top">
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ formatDateTime(r.start) }}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ formatDateTime(r.end) }}</td>
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ duration(r.durationMs) }}</td>
                <td class="py-1.5 pr-3"><StatusBadge v-if="r.status" :status="String(r.status)" automation /><span v-else>—</span></td>
                <td class="py-1.5 pr-3 break-words">
                  <template v-if="r.errors?.length">
                    <div v-for="(e, k) in r.errors" :key="k" class="text-red-700 dark:text-red-400">
                      {{ e.step != null ? `Step ${e.step}, ` : '' }}{{ e.activity }}: {{ e.message }}
                      <button v-if="e.workerUrl && !workers[e.workerUrl]" class="ml-1 text-primary hover:underline" @click="loadWorker(e.workerUrl)">Why?</button>
                      <span v-if="workers[e.workerUrl]?.busy" class="text-muted-foreground"> reading...</span>
                      <span v-else-if="workers[e.workerUrl]?.error" class="block text-muted-foreground">Could not read the step: {{ workers[e.workerUrl].error }}</span>
                      <template v-else-if="workers[e.workerUrl]">
                        <span class="block text-foreground">{{ workers[e.workerUrl].message || 'The step record has no more detail (see its JSON).' }}</span>
                        <details class="text-muted-foreground"><summary class="cursor-pointer text-primary">Step JSON</summary><CodeView :code="JSON.stringify(workers[e.workerUrl].raw, null, 2)" lang="javascript" /></details>
                      </template>
                    </div>
                  </template>
                  <template v-else>{{ r.message || '' }}</template>
                </td>
                <td class="py-1.5 text-right whitespace-nowrap"><button class="text-primary hover:underline" @click="toggleRaw(i)">{{ expanded.has(i) ? 'Hide JSON' : 'See full JSON' }}</button></td>
              </tr>
              <tr v-if="expanded.has(i)"><td colspan="6" class="pb-2"><CodeView :code="JSON.stringify(r.raw, null, 2)" lang="javascript" /></td></tr>
            </template>
            <tr v-if="!runs.length"><td colspan="6" class="py-3 text-center text-muted-foreground">No runs in the last {{ days }} days.</td></tr>
          </tbody>
        </table>
      </div>
      <button v-if="runs && total > runs.length" class="h-7 px-2 rounded-md border border-border hover:bg-accent disabled:opacity-50" :disabled="loading" @click="more">Load 50 more</button>
    </div>
  </section>
</template>
