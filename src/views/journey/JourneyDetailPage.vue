<script setup>
// One journey on a canvas (horizontal or vertical), with each node's content in a
// side panel: email subject, preheader and a preview, waits, split paths and their
// criteria, and every setting. Read-only, except Remove contacts from this journey
// (API idea 4, user 2026-11-11), which the user starts and confirms.
import ReportErrorButton from '@/components/results/ReportErrorButton.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PrevNext from '@/components/shell/PrevNext.vue'
import { ArrowLeft, Loader2, ExternalLink, X, Columns3, Rows3, UserSearch, Footprints, ChevronDown, ChevronRight, UserMinus } from 'lucide-vue-next'
import JourneyCanvas from '@/components/journey/JourneyCanvas.vue'
import JourneyContactCheck from '@/components/journey/JourneyContactCheck.vue'
import JourneyPathsControl from '@/components/journey/JourneyPathsControl.vue'
import JourneyExitDialog from '@/components/journey/JourneyExitDialog.vue'
import JourneyEmailResults from '@/components/journey/JourneyEmailResults.vue'
import { policy } from '@/utils/policy.js'
import ActivityCard from '@/components/results/ActivityCard.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import WatchButton from '@/components/automation/WatchButton.vue'
import { openInSfmc } from '@/utils/sfmcLinks.js'
import { useStack } from '@/composables/useStack.js'
import { searchJourneys, primaryVersion, LIVE_VERSION } from '@/utils/journeys.js'
import { statusWords } from '@/utils/format.js'
import { fetchJourneyStats, fetchJourneyEvent, fetchJourneyAudit } from '@/utils/journeys.js'
import { formatDateTime } from '@/utils/format.js'
import { journeyStatusWord, populationByNode } from '@/utils/journeySummary.js'
import { fetchJourney, journeyGraph, layoutJourney, describeJourneyNode, journeyOverviewRows, journeyBuilderUrl, journeyDoc, nodeEmailId, fetchJourneyEmailAsset, sendNames, hasEmailStep } from '@/utils/journeys.js'
import { compile } from '@/utils/emailCompiler.js'
import { journeySvg } from '@/utils/journeySvg.js'
import AiButton from '@/components/ai/AiButton.vue'
import AskAiDialog from '@/components/ai/AskAiDialog.vue'
import { useAi } from '@/composables/useAi.js'
import { AI_TEXT_SYSTEM, buildAiTaskPrompt, docText } from '@/utils/aiAssist.js'

const ORIENTATION_KEY = 'toolkit_journey_orientation'
const route = useRoute()
const router = useRouter()
const { stack } = useStack()

const journey = ref(null)
const loading = ref(true)
const error = ref('')
const selected = ref(null)
let loadGeneration = 0

// Step details panel: drag its left edge to resize (feedback #42); width remembered.
const PANEL_KEY = 'toolkit_journey_panel_w'
const panelWidth = ref((() => { try { return Math.min(Math.max(Number(localStorage.getItem(PANEL_KEY)) || 416, 280), 1400) } catch { return 416 } })())
function startResize(e) {
  const startX = e.clientX
  const startW = panelWidth.value
  const move = (ev) => { panelWidth.value = Math.min(Math.max(startW + (startX - ev.clientX), 280), window.innerWidth * 0.7) }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    try { localStorage.setItem(PANEL_KEY, String(Math.round(panelWidth.value))) } catch { /* storage blocked */ }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  e.preventDefault()
}
const orientation = ref('horizontal')
try { if (localStorage.getItem(ORIENTATION_KEY) === 'vertical') orientation.value = 'vertical' } catch { /* storage blocked */ }
const canvas = ref(null)
watch(orientation, (v) => {
  try { localStorage.setItem(ORIENTATION_KEY, v) } catch { /* storage blocked */ }
})

// Contacts on this journey (feedback #1088, #1089): panels opened by their buttons;
// nothing is read until the panel's own Check or Show paths.
const panel = ref('') // '' | 'check' | 'paths'
const pathCounts = ref(null) // aggregatePaths output drawn on the canvas
function togglePanel(name) { panel.value = panel.value === name ? '' : name }
// Remove contacts (API idea 4): shown to everyone unless the admin policy turns it off.
const exitOpen = ref(false)

function selectActivity(key) {
  selected.value = selected.value === key ? null : key
}

async function closeDetails() {
  const key = selected.value
  selected.value = null
  await nextTick()
  canvas.value?.focusActivity(key)
}

async function load() {
  if (!stack.value || !route.params.id) return
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  selected.value = null
  pathCounts.value = null
  try {
    const result = await fetchJourney(stack.value, String(route.params.id), route.query.version)
    if (generation === loadGeneration) {
      journey.value = result
      if (versions.value[0]?.id !== result?.id) loadVersions(result)
      loadExtras(result, generation)
    }
  } catch (e) {
    if (generation === loadGeneration) error.value = `Could not load this journey: ${e.message}`
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
// What Journey Builder also shows (user, 2026-11-10): the entry event's data extension and
// key, and how many contacts reached each activity. Two calls; the page works without them.
const journeyEvent = ref(null)
const stats = ref(null)
async function loadExtras(j, generation) {
  journeyEvent.value = null
  stats.value = null
  const [ev, st] = await Promise.all([fetchJourneyEvent(stack.value, j), fetchJourneyStats(stack.value, j.id, j.version)])
  if (generation !== loadGeneration) return
  journeyEvent.value = ev
  stats.value = st
}
// Who changed the journey (user, 2026-11-10): read when the section is opened.
const audit = ref({ open: false, items: null, loading: false, error: '' })
async function toggleAudit() {
  audit.value.open = !audit.value.open
  if (!audit.value.open || audit.value.items || audit.value.loading) return
  audit.value.loading = true
  try { audit.value.items = await fetchJourneyAudit(stack.value, journey.value.id) } catch (e) { audit.value.error = e.message } finally { audit.value.loading = false }
}
watch(() => journey.value?.id, () => { audit.value = { open: false, items: null, loading: false, error: '' } })
// Every version of this journey, to switch between them: the list opens the newest,
// which can be a draft while an older version is the published one (live test,
// 2026-11-08: "Welcome Journey", version 3 draft, version 2 published).
const versions = ref([])
async function loadVersions(j) {
  versions.value = []
  if (!j?.id || !j.name) return
  try {
    const r = await searchJourneys(stack.value, { query: j.name, allVersions: true })
    const mine = r.items.filter((v) => v.id === j.id).sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
    if (journey.value?.id === j.id) versions.value = mine
  } catch { /* the page works without the version list */ }
}
const liveVersion = computed(() => {
  const p = primaryVersion(versions.value)
  return p && LIVE_VERSION.test(String(p.status || '')) ? p : null
})
function pickVersion(v) { router.push({ path: route.path, query: { ...route.query, version: String(v) } }) }

watch([() => route.params.id, () => route.query.version, stack], () => { if (route.path.startsWith('/journeys/')) load() }, { immediate: true })

const graph = computed(() => (journey.value ? journeyGraph(journey.value) : { nodes: [], edges: [] }))
const layout = computed(() => layoutJourney(graph.value))
const population = computed(() => (stats.value && journey.value ? populationByNode(stats.value, journey.value, graph.value) : null))
const overviewExtra = computed(() => ({ event: journeyEvent.value }))
const selectedNode = computed(() => graph.value.nodes.find((n) => n.key === selected.value) || null)
const nameOf = (k) => graph.value.nodes.find((n) => n.key === k)?.name || k
// Send classification, sender and delivery profile names for email steps (live test,
// 2026-11-07: they showed as IDs). Read once per stack; until then the IDs show.
const profileNames = ref(null)
watch([journey, stack], async ([j, s]) => {
  if (!j || !s || !hasEmailStep(j) || profileNames.value?.stack === s) return
  try {
    const read = await sendNames(s)
    if (stack.value === s) profileNames.value = { stack: s, names: read }
  } catch { /* the IDs stay */ }
}, { immediate: true })
const names = computed(() => (profileNames.value?.stack === stack.value ? profileNames.value.names : null))
const selectedDesc = computed(() => (selectedNode.value ? describeJourneyNode(selectedNode.value, nameOf, names.value) : null))

// Email preview for an email node, from its Content Builder asset.
const preview = ref({ status: 'idle' }) // idle | loading | ok | none | error
watch(selectedNode, async (n) => {
  preview.value = { status: 'idle' }
  const emailId = n && nodeEmailId(n)
  if (!emailId) return
  preview.value = { status: 'loading' }
  try {
    const asset = await fetchJourneyEmailAsset(stack.value, emailId)
    if (selectedNode.value !== n) return
    const html = asset ? compile(asset, 'html') : null
    preview.value = html ? { status: 'ok', html, name: asset.name } : { status: 'none' }
  } catch (e) {
    if (selectedNode.value === n) preview.value = { status: 'error', error: e.message }
  }
})

const getDoc = () => journeyDoc(journey.value, graph.value, layout.value, journeySvg(graph.value, layout.value, orientation.value), names.value, overviewExtra.value)
// Summarize with AI (feedback #1029, experimental): the download's text, without the picture.
const ai = useAi()
const summaryOpen = ref(false)
const summaryPrompt = (extra) => buildAiTaskPrompt('journey', { text: docText(journeyDoc(journey.value, graph.value, layout.value, '', names.value)) + (extra.trim() ? `\n\nAlso answer: ${extra.trim()}` : '') })
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <RouterLink to="/journeys" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Back to journeys"><ArrowLeft class="h-4 w-4" /></RouterLink>
      <PrevNext kind="journeys" :id="String(route.params.id || '')" base="/journeys" noun="journey" />
      <h1 class="text-sm font-semibold truncate">{{ journey?.name || 'Journey' }}</h1>
      <template v-if="journey">
        <StatusBadge :status="journey.status" :label="journeyStatusWord(journey.status)" />
        <select v-if="versions.length > 1" :value="String(journey.version)" aria-label="Version" class="h-7 rounded-md border border-border bg-background px-1 text-xs" @change="pickVersion($event.target.value)">
          <option v-for="v in versions" :key="v.version" :value="String(v.version)">Version {{ v.version }} · {{ statusWords(v.status) }}</option>
        </select>
        <span v-else class="text-xs text-muted-foreground">Version {{ journey.version }}</span>
        <button v-if="liveVersion && String(liveVersion.version) !== String(journey.version)" type="button" data-live-version class="text-xs text-primary hover:underline" @click="pickVersion(liveVersion.version)">
          Version {{ liveVersion.version }} is {{ statusWords(liveVersion.status).toLowerCase() }}: show it
        </button>
        <div class="flex-1" />
        <div class="flex items-center gap-0.5 border border-border rounded-md p-0.5" role="group" aria-label="Layout">
          <button class="flex items-center gap-1 text-xs px-2 py-0.5 rounded" :class="orientation === 'horizontal' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            :aria-pressed="orientation === 'horizontal'" @click="orientation = 'horizontal'"><Columns3 class="h-3.5 w-3.5" /> Horizontal</button>
          <button class="flex items-center gap-1 text-xs px-2 py-0.5 rounded" :class="orientation === 'vertical' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            :aria-pressed="orientation === 'vertical'" @click="orientation = 'vertical'"><Rows3 class="h-3.5 w-3.5" /> Vertical</button>
        </div>
        <a :href="journeyBuilderUrl(stack, journey)" @click="openInSfmc($event, journeyBuilderUrl(stack, journey))" target="_blank" rel="noopener" class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent">Journey Builder <ExternalLink class="h-3 w-3" /></a>
        <WatchButton type="journey" :stack="stack" :items="[journey]" />
        <AiButton label="Summarize" title="Summarize this journey (experimental, Gemini Nano in Chrome)" @click="summaryOpen = true" />
        <DownloadMenu :get-doc="getDoc" :file-name="journey.name || 'journey'" />
      </template>
    </div>

    <div v-if="loading" class="p-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading the journey…</div>
    <div v-else-if="error" class="p-4 text-sm text-red-600" role="alert">
      <p>{{ error }}<ReportErrorButton /></p>
      <button type="button" class="mt-2 rounded-md border border-border px-3 py-1 text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" @click="load">Retry</button>
    </div>
    <div v-else-if="journey" class="relative flex-1 min-h-0 flex">
      <div class="flex-1 min-w-0 overflow-auto">
        <section class="m-4 rounded-lg border border-border bg-card p-3">
          <dl class="grid grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs md:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(7rem,9rem)_minmax(0,1fr)]">
            <template v-for="[k, v] in journeyOverviewRows(journey, overviewExtra)" :key="k"><dt class="text-muted-foreground">{{ k }}</dt><dd class="wrap-break-word">{{ v }}</dd></template>
          </dl>
        </section>
        <div class="mx-4 mb-2 flex flex-wrap items-center gap-2">
          <button type="button" class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs hover:bg-accent" :class="panel === 'check' ? 'bg-accent' : ''"
            :aria-expanded="panel === 'check'" data-open-contact-check @click="togglePanel('check')"><UserSearch class="h-3.5 w-3.5" /> Is a contact in this journey?</button>
          <button type="button" class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs hover:bg-accent" :class="panel === 'paths' || pathCounts ? 'bg-accent' : ''"
            :aria-expanded="panel === 'paths'" data-open-contact-paths @click="togglePanel('paths')"><Footprints class="h-3.5 w-3.5" /> Contact paths<span v-if="pathCounts" class="text-muted-foreground"> (shown)</span></button>
          <button v-if="!policy.disableJourneyWrites" type="button" class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-red-300 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            data-open-journey-exit @click="exitOpen = true"><UserMinus class="h-3.5 w-3.5" /> Remove contacts from this journey</button>
        </div>
        <div v-show="panel === 'check'" class="mx-4 mb-3">
          <JourneyContactCheck :key="`check:${journey.id}:${journey.version}`" :stack="stack" :journey="journey" :versions="versions" />
        </div>
        <div v-show="panel === 'paths'" class="mx-4 mb-3">
          <JourneyPathsControl :key="`paths:${journey.id}:${journey.version}`" :stack="stack" :journey="journey" :versions="versions" :graph="graph" @counts="pathCounts = $event" />
        </div>
        <p class="mx-4 mb-2 text-xs text-muted-foreground">Click an activity to see its configuration and email preview. Drag to pan; scroll to zoom.<template v-if="population && !pathCounts"> The number under each activity is how many contacts reached it in this version, as in Journey Builder.</template></p>
        <div class="mx-4 mb-4">
          <JourneyCanvas :key="`${journey.id}:${journey.version}`" ref="canvas" :graph="graph" :layout="layout" :orientation="orientation" :selected="selected" :counts="pathCounts" :population="pathCounts ? null : population" @select="selectActivity" />
        </div>
        <JourneyEmailResults :key="`results:${journey.id}:${journey.version}`" class="mx-4 mb-4" :stack="stack" :journey="journey" />
        <section class="mx-4 mb-4 rounded-lg border border-border bg-card text-xs" data-journey-audit>
          <button type="button" class="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-semibold" :aria-expanded="audit.open" @click="toggleAudit">
            <ChevronDown v-if="audit.open" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /> Changes to this journey
            <span class="font-normal text-xs text-muted-foreground">Who created, saved, published, stopped or deleted each version (Journey Builder's audit log)</span>
          </button>
          <div v-if="audit.open" class="px-3 pb-3">
            <div v-if="audit.loading" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Reading…</div>
            <p v-else-if="audit.error" class="text-red-600">Could not read the audit log: {{ audit.error }}<ReportErrorButton /></p>
            <p v-else-if="!audit.items?.length" class="italic text-muted-foreground">No entries.</p>
            <table v-else class="w-full">
              <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-3 font-medium">When</th><th class="py-1 pr-3 font-medium">Action</th><th class="py-1 pr-3 font-medium">Version</th><th class="py-1 font-medium">By</th></tr></thead>
              <tbody><tr v-for="(a, i) in audit.items" :key="i" class="border-t border-border"><td class="py-1 pr-3 whitespace-nowrap">{{ formatDateTime(a.timeStamp) }}</td><td class="py-1 pr-3">{{ statusWords(a.action) }}</td><td class="py-1 pr-3">{{ a.versionNumber ?? '' }}</td><td class="py-1">{{ a.user?.name || a.user?.userId || '' }}</td></tr></tbody>
            </table>
          </div>
        </section>
        <section v-if="journey.goals?.length || journey.exits?.length" class="mx-4 mb-4 text-xs text-muted-foreground">
          <span v-if="journey.goals?.length">Goals: {{ journey.goals.map((g) => g.name || g.key).join(', ') }}. </span>
          <span v-if="journey.exits?.length">Exit criteria: {{ journey.exits.length }}. </span>
          Both are in the download.
        </section>
      </div>

      <aside v-if="selectedDesc" class="journey-details relative shrink-0 border-l border-border bg-background overflow-y-auto" :style="{ width: `${panelWidth}px`, maxWidth: '70%' }" aria-label="Step details" @keydown.esc.stop="closeDetails">
        <div class="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/30 z-20" role="separator" aria-orientation="vertical" aria-label="Resize step details" title="Drag to resize" @pointerdown="startResize" />
        <div class="sticky top-0 z-10 flex justify-end bg-background p-1"><button type="button" class="p-1 rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" title="Close" aria-label="Close activity details" @click="closeDetails"><X class="h-4 w-4" /></button></div>
        <div class="px-3 pb-4 space-y-3">
          <ActivityCard :description="selectedDesc" />
          <div v-if="preview.status !== 'idle'" class="rounded-lg border border-border bg-card">
            <div class="px-3 py-2 border-b border-border text-xs font-semibold">Email preview<span v-if="preview.name" class="font-normal text-muted-foreground"> · {{ preview.name }}</span></div>
            <div v-if="preview.status === 'loading'" class="p-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Finding the email in Content Builder…</div>
            <p v-else-if="preview.status === 'none'" class="p-3 text-xs text-muted-foreground">This email was not found in Content Builder.</p>
            <p v-else-if="preview.status === 'error'" class="p-3 text-xs text-red-600">Could not load the email: {{ preview.error }}<ReportErrorButton /></p>
            <iframe v-else :srcdoc="preview.html" sandbox class="w-full h-112 border-0 bg-white rounded-b-lg" title="Email preview" />
          </div>
        </div>
      </aside>
    </div>
    <JourneyExitDialog v-if="exitOpen && journey && !policy.disableJourneyWrites" :stack="stack" :journey="journey" :versions="versions" @close="exitOpen = false" />
    <AskAiDialog v-if="ai.shown.value && journey" :open="summaryOpen" title="Summarize this journey" :system="AI_TEXT_SYSTEM"
      :prompt="summaryPrompt" extra-label="Anything else to ask about it?" @close="summaryOpen = false" />
  </div>
</template>

<style scoped>
@media (max-width: 800px) {
  .journey-details { position: absolute; inset: 0 0 0 auto; z-index: 10; width: min(416px, 100%) !important; max-width: 100% !important; box-shadow: -4px 0 12px rgb(0 0 0 / .1); }
}
</style>
