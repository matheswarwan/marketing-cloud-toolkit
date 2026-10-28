<script setup>
// One automation: overview, schedule, error notifications and every step's activities,
// as an Overview (steps side by side, like Automation Studio) or a Full view (every
// activity's details). Read-only.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Loader2, ExternalLink, Mail, ChevronDown, ChevronRight, X, Network } from 'lucide-vue-next'
import { useUsage } from '@/composables/useUsage.js'
import ActivityCard from '@/components/results/ActivityCard.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import ActivityIcon from '@/components/results/ActivityIcon.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import RunHistory from '@/components/automation/RunHistory.vue'
import WatchButton from '@/components/automation/WatchButton.vue'
import { useStack } from '@/composables/useStack.js'
import { fetchAutomation, fetchActivityDetails, fetchAutomationStatus, fetchLatestRun } from '@/utils/automationApi.js'
import { automationRunState, createPoller } from '@/utils/runProgress.js'
import { describeActivity, activityTypeLabel, automationUrl } from '@/utils/activityTypes.js'
import { openInSfmc } from '@/utils/sfmcLinks.js'
import { automationOverviewRows, scheduleRows, automationDoc } from '@/utils/automationDoc.js'
import { runInBatches } from '@/utils/batchRunner.js'

const route = useRoute()
const { stack } = useStack()
const usage = useUsage()

const details = ref(null)
const notifications = ref(null)
const loading = ref(true)
const error = ref('')
const acts = reactive({}) // "si.ai" → { status: 'loading' | 'ok' | 'error', desc, error }
const view = ref('full')
const showAllFields = ref(false)
const open = reactive({ schedule: true, notifications: false })
const modal = ref(null) // "si.ai" of the activity shown in the Overview modal

const id = computed(() => String(route.params.id || ''))
const key = (si, ai) => `${si}.${ai}`
// "0.1" (internal key) → "1.2" (as shown to people)
const stepLabel = (k) => k.split('.').map((n) => Number(n) + 1).join('.')

async function load() {
  if (!stack.value || !id.value) return
  loading.value = true
  error.value = ''
  for (const k of Object.keys(acts)) delete acts[k]
  try {
    const r = await fetchAutomation(stack.value, id.value)
    details.value = r.details
    notifications.value = r.notifications
    latestRun.value = null
    watchRun()
  } catch (e) {
    error.value = `Could not load this automation: ${e.message}`
    loading.value = false
    return
  }
  loading.value = false
  const list = []
  ;(details.value.steps || []).forEach((step, si) => (step.activities || []).forEach((a, ai) => {
    acts[key(si, ai)] = { status: 'loading' }
    list.push({ a, k: key(si, ai) })
  }))
  // A few at a time, so a long automation doesn't fire every request at once.
  await runInBatches(list, 4, async ({ a, k }) => {
    try {
      acts[k] = { status: 'ok', desc: describeActivity(a.objectTypeId, await fetchActivityDetails(stack.value, a), stack.value) }
    } catch (e) {
      acts[k] = { status: 'error', error: e.message, desc: describeActivity(a.objectTypeId, { ...a, _fromStep: true }, stack.value) }
    }
  })
}
watch([id, stack], load, { immediate: true })

// ── Running bar (feedback #123) ─────────────────────────
// While the automation runs, its status and latest run are read again every 5 seconds;
// it stops when the run ends, the page is left, or (until shown again) the tab is hidden.
const latestRun = ref(null)
const runState = computed(() => automationRunState(details.value, latestRun.value))
const historyKey = ref(0) // reloads an open run history when a run ends
async function pollTick() {
  const [d, run] = await Promise.all([
    fetchAutomationStatus(stack.value, id.value),
    fetchLatestRun(stack.value, id.value).catch(() => latestRun.value),
  ])
  if (d && String(d.id ?? id.value) === String(details.value?.id ?? id.value)) details.value = { ...details.value, ...d, steps: d.steps || details.value?.steps }
  latestRun.value = run
  if (!automationRunState(details.value, run).running) historyKey.value++
}
const poller = createPoller({ interval: 5000, tick: pollTick, shouldContinue: () => runState.value.running })
function watchRun() {
  poller.stop()
  if (!runState.value.running) return
  fetchLatestRun(stack.value, id.value).then((r) => { latestRun.value = r }).catch(() => {})
  poller.start()
}
onBeforeUnmount(() => poller.stop())

const steps = computed(() => details.value?.steps || [])
const workers = computed(() => notifications.value?.workers || [])
const pending = computed(() => Object.values(acts).filter((x) => x.status === 'loading').length)

function getDoc() {
  return automationDoc(details.value, notifications.value, (si, ai) => acts[key(si, ai)]?.desc || null)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <RouterLink to="/automations" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Back to automations"><ArrowLeft class="h-4 w-4" /></RouterLink>
      <h1 class="text-sm font-semibold truncate">{{ details?.name || 'Automation' }}</h1>
      <StatusBadge v-if="details" :status="details.status ?? details.statusId" automation />
      <span v-if="pending" class="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Loading {{ pending }} activities</span>
      <div class="flex-1" />
      <template v-if="details">
        <div class="flex items-center gap-0.5 border border-border rounded-md p-0.5" role="group" aria-label="View">
          <button class="text-xs px-2 py-0.5 rounded" :class="view === 'overview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-pressed="view === 'overview'" @click="view = 'overview'">Overview</button>
          <button class="text-xs px-2 py-0.5 rounded" :class="view === 'full' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-pressed="view === 'full'" @click="view = 'full'">Full view</button>
        </div>
        <label v-if="view === 'full'" class="flex items-center gap-1.5 text-xs text-muted-foreground"><input v-model="showAllFields" type="checkbox" /> All fields</label>
        <button class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent" title="Data extensions, files and emails this automation touches" @click="usage.start(stack, { kind: 'automation', id: details.id || id, name: details.name })"><Network class="h-3.5 w-3.5" /> What it touches</button>
        <WatchButton :stack="stack" :items="[{ ...(details || {}), id }]" />
        <a :href="automationUrl(stack, details.id)" @click="openInSfmc($event, automationUrl(stack, details.id))" title="Open this automation in Automation Studio" target="_blank" rel="noopener" class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent">Automation Studio <ExternalLink class="h-3 w-3" /></a>
        <DownloadMenu :get-doc="getDoc" :file-name="details.name || 'automation'" :disabled="pending > 0" />
      </template>
    </div>

    <div v-if="details && runState.running" class="px-4 py-2 border-b border-border bg-card" role="status">
      <ProgressBar :value="runState.step || 0" :max="runState.step && runState.total ? runState.total : 0" striped size="md"
        :label="runState.label" aria-label="Automation running" bar-class="max-w-md" />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading the automation…</div>
      <p v-else-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      <template v-else-if="details">
        <section class="rounded-lg border border-border bg-card p-3">
          <dl class="grid grid-cols-[minmax(7rem,10rem)_1fr_minmax(7rem,10rem)_1fr] gap-x-4 gap-y-1 text-xs">
            <template v-for="[k, v] in automationOverviewRows(details)" :key="k"><dt class="text-muted-foreground">{{ k }}</dt><dd class="wrap-break-word">{{ v }}</dd></template>
          </dl>
        </section>

        <section v-if="details.schedule" class="rounded-lg border border-border bg-card">
          <button class="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-semibold" :aria-expanded="open.schedule" @click="open.schedule = !open.schedule">
            <ChevronDown v-if="open.schedule" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /> Schedule
          </button>
          <div v-if="open.schedule" class="grid grid-cols-2 md:grid-cols-3 gap-2 px-3 pb-3">
            <div v-for="[k, v] in scheduleRows(details.schedule)" :key="k" class="rounded-md border border-border p-2">
              <div class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{{ k }}</div>
              <div class="text-sm" :class="{ 'text-primary font-medium': k === 'Next run' }">{{ v }}</div>
            </div>
          </div>
        </section>

        <section v-if="workers.length" class="rounded-lg border border-border bg-card">
          <button class="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-semibold" :aria-expanded="open.notifications" @click="open.notifications = !open.notifications">
            <ChevronDown v-if="open.notifications" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /> Error notifications ({{ workers.length }})
          </button>
          <div v-if="open.notifications" class="flex flex-wrap gap-2 px-3 pb-3">
            <a v-for="(w, i) in workers" :key="i" :href="`mailto:${w.definition}`" class="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-primary hover:bg-accent">
              <Mail class="h-3.5 w-3.5" /> {{ w.definition }}<span v-if="w.notificationType" class="text-muted-foreground">· {{ w.notificationType }}</span>
            </a>
          </div>
        </section>

        <RunHistory :stack="stack" :automation-id="id" :refresh-key="historyKey" />

        <!-- Overview: steps left to right, like Automation Studio -->
        <section v-if="view === 'overview'" class="overflow-x-auto pb-2">
          <div class="flex items-start gap-1 min-w-max">
            <template v-for="(step, si) in steps" :key="si">
              <div v-if="si" class="self-center px-1 text-muted-foreground" aria-hidden="true">→</div>
              <div class="w-56 rounded-lg border bg-card" :class="runState.running && runState.step === si + 1 ? 'border-primary ring-1 ring-primary' : 'border-border'">
                <div class="px-3 py-2 border-b border-border bg-muted/40 rounded-t-lg">
                  <div class="text-xs font-bold text-primary">Step {{ si + 1 }}</div>
                  <ProgressBar v-if="runState.running && runState.step === si + 1" indeterminate size="xs" aria-label="This step is running" class="mt-1" />
                  <div v-if="step.name" class="text-[11px] text-muted-foreground line-clamp-2">{{ step.name }}</div>
                </div>
                <div class="p-2 space-y-1.5">
                  <button v-for="(a, ai) in step.activities || []" :key="ai" class="w-full text-left rounded-md border border-border px-2 py-1.5 hover:bg-accent" @click="modal = key(si, ai)">
                    <div class="flex items-center gap-1 text-[10px] font-semibold uppercase text-primary">
                      <ActivityIcon :type="a.objectTypeId" size="h-3 w-3" />
                      {{ activityTypeLabel(a.objectTypeId) }}
                      <Loader2 v-if="acts[key(si, ai)]?.status === 'loading'" class="h-3 w-3 animate-spin" />
                      <span class="ml-auto text-muted-foreground font-normal">{{ si + 1 }}.{{ ai + 1 }}</span>
                    </div>
                    <div class="text-xs truncate" :title="a.name">{{ a.name }}</div>
                  </button>
                  <p v-if="!step.activities?.length" class="text-xs text-muted-foreground italic">No activities.</p>
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- Full view: every activity's details -->
        <section v-else class="space-y-5">
          <div v-for="(step, si) in steps" :key="si">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-primary mb-2">Step {{ si + 1 }}{{ step.name ? `: ${step.name}` : '' }}
              <ProgressBar v-if="runState.running && runState.step === si + 1" indeterminate size="xs" label="Running" class="w-40 font-normal" />
            </h2>
            <div class="space-y-3">
              <template v-for="(a, ai) in step.activities || []" :key="ai">
                <div v-if="acts[key(si, ai)]?.status === 'loading'" class="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                  <Loader2 class="h-3.5 w-3.5 animate-spin" /> <ActivityIcon :type="a.objectTypeId" /> {{ si + 1 }}.{{ ai + 1 }} {{ a.name }}
                </div>
                <template v-else-if="acts[key(si, ai)]">
                  <p v-if="acts[key(si, ai)].status === 'error'" class="text-xs text-red-600">Could not load {{ si + 1 }}.{{ ai + 1 }}: {{ acts[key(si, ai)].error }}</p>
                  <ActivityCard :description="acts[key(si, ai)].desc" :heading="`${si + 1}.${ai + 1}`" :show-all-fields="showAllFields" />
                </template>
              </template>
              <p v-if="!step.activities?.length" class="text-xs text-muted-foreground italic">No activities.</p>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- Activity modal (Overview) -->
    <div v-if="modal && acts[modal]" class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="modal = null" @keydown.esc="modal = null">
      <div class="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-lg bg-background shadow-xl" role="dialog" aria-modal="true">
        <div class="sticky top-0 z-10 flex justify-end bg-background p-1"><button class="p-1 rounded hover:bg-accent" title="Close" @click="modal = null"><X class="h-4 w-4" /></button></div>
        <div v-if="acts[modal].status === 'loading'" class="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading…</div>
        <ActivityCard v-else :description="acts[modal].desc" :heading="stepLabel(modal)" />
      </div>
    </div>
  </div>
</template>
