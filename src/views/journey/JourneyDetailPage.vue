<script setup>
// One journey on a canvas (horizontal or vertical), with each node's content in a
// side panel: email subject, preheader and a preview, waits, split paths and their
// criteria, and every setting. Read-only.
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Loader2, ExternalLink, X, Columns3, Rows3 } from 'lucide-vue-next'
import JourneyCanvas from '@/components/journey/JourneyCanvas.vue'
import ActivityCard from '@/components/results/ActivityCard.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import WatchButton from '@/components/automation/WatchButton.vue'
import { openInSfmc } from '@/utils/sfmcLinks.js'
import { useStack } from '@/composables/useStack.js'
import { fetchJourney, journeyGraph, layoutJourney, describeJourneyNode, journeyOverviewRows, journeyBuilderUrl, journeyDoc, nodeEmailId, fetchJourneyEmailAsset } from '@/utils/journeys.js'
import { compile } from '@/utils/emailCompiler.js'
import { journeySvg } from '@/utils/journeySvg.js'

const ORIENTATION_KEY = 'toolkit_journey_orientation'
const route = useRoute()
const { stack } = useStack()

const journey = ref(null)
const loading = ref(true)
const error = ref('')
const selected = ref(null)

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
const canvasBox = ref(null)
watch(orientation, (v) => {
  try { localStorage.setItem(ORIENTATION_KEY, v) } catch { /* storage blocked */ }
  canvasBox.value?.scrollTo({ left: 0, top: 0 })
})

async function load() {
  if (!stack.value || !route.params.id) return
  loading.value = true
  error.value = ''
  selected.value = null
  try {
    journey.value = await fetchJourney(stack.value, String(route.params.id), route.query.version)
  } catch (e) {
    error.value = `Could not load this journey: ${e.message}`
  } finally {
    loading.value = false
  }
}
watch([() => route.params.id, () => route.query.version, stack], () => { if (route.path.startsWith('/journeys/')) load() }, { immediate: true })

const graph = computed(() => (journey.value ? journeyGraph(journey.value) : { nodes: [], edges: [] }))
const layout = computed(() => layoutJourney(graph.value))
const selectedNode = computed(() => graph.value.nodes.find((n) => n.key === selected.value) || null)
const nameOf = (k) => graph.value.nodes.find((n) => n.key === k)?.name || k
const selectedDesc = computed(() => (selectedNode.value ? describeJourneyNode(selectedNode.value, nameOf) : null))

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

const getDoc = () => journeyDoc(journey.value, graph.value, layout.value, journeySvg(graph.value, layout.value, orientation.value))
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <RouterLink to="/journeys" class="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Back to journeys"><ArrowLeft class="h-4 w-4" /></RouterLink>
      <h1 class="text-sm font-semibold truncate">{{ journey?.name || 'Journey' }}</h1>
      <template v-if="journey">
        <StatusBadge :status="journey.status" />
        <span class="text-xs text-muted-foreground">Version {{ journey.version }}</span>
        <div class="flex-1" />
        <div class="flex items-center gap-0.5 border border-border rounded-md p-0.5" role="group" aria-label="Layout">
          <button class="flex items-center gap-1 text-xs px-2 py-0.5 rounded" :class="orientation === 'horizontal' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            :aria-pressed="orientation === 'horizontal'" @click="orientation = 'horizontal'"><Columns3 class="h-3.5 w-3.5" /> Horizontal</button>
          <button class="flex items-center gap-1 text-xs px-2 py-0.5 rounded" :class="orientation === 'vertical' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
            :aria-pressed="orientation === 'vertical'" @click="orientation = 'vertical'"><Rows3 class="h-3.5 w-3.5" /> Vertical</button>
        </div>
        <a :href="journeyBuilderUrl(stack, journey)" @click="openInSfmc($event, journeyBuilderUrl(stack, journey))" target="_blank" rel="noopener" class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent">Journey Builder <ExternalLink class="h-3 w-3" /></a>
        <WatchButton type="journey" :stack="stack" :items="[journey]" />
        <DownloadMenu :get-doc="getDoc" :file-name="journey.name || 'journey'" />
      </template>
    </div>

    <div v-if="loading" class="p-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading the journey…</div>
    <p v-else-if="error" class="p-4 text-sm text-red-600" role="alert">{{ error }}</p>
    <div v-else-if="journey" class="flex-1 min-h-0 flex">
      <div class="flex-1 min-w-0 overflow-auto">
        <section class="m-4 rounded-lg border border-border bg-card p-3">
          <dl class="grid grid-cols-[minmax(7rem,9rem)_1fr_minmax(7rem,9rem)_1fr] gap-x-4 gap-y-1 text-xs">
            <template v-for="[k, v] in journeyOverviewRows(journey)" :key="k"><dt class="text-muted-foreground">{{ k }}</dt><dd class="wrap-break-word">{{ v }}</dd></template>
          </dl>
        </section>
        <p class="mx-4 mb-2 text-xs text-muted-foreground">Click a step to see what it does.</p>
        <div ref="canvasBox" class="mx-4 mb-4 overflow-auto max-h-[70vh] rounded-lg border border-border bg-[radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] bg-size-[16px_16px]">
          <JourneyCanvas :graph="graph" :layout="layout" :orientation="orientation" :selected="selected" @select="selected = selected === $event ? null : $event" />
        </div>
        <section v-if="journey.goals?.length || journey.exits?.length" class="mx-4 mb-4 text-xs text-muted-foreground">
          <span v-if="journey.goals?.length">Goals: {{ journey.goals.map((g) => g.name || g.key).join(', ') }}. </span>
          <span v-if="journey.exits?.length">Exit criteria: {{ journey.exits.length }}. </span>
          Both are in the download.
        </section>
      </div>

      <aside v-if="selectedDesc" class="relative shrink-0 border-l border-border bg-background overflow-y-auto" :style="{ width: `${panelWidth}px`, maxWidth: '70%' }" aria-label="Step details">
        <div class="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/30 z-20" role="separator" aria-orientation="vertical" aria-label="Resize step details" title="Drag to resize" @pointerdown="startResize" />
        <div class="sticky top-0 z-10 flex justify-end bg-background p-1"><button class="p-1 rounded hover:bg-accent" title="Close" @click="selected = null"><X class="h-4 w-4" /></button></div>
        <div class="px-3 pb-4 space-y-3">
          <ActivityCard :description="selectedDesc" />
          <div v-if="preview.status !== 'idle'" class="rounded-lg border border-border bg-card">
            <div class="px-3 py-2 border-b border-border text-xs font-semibold">Email preview<span v-if="preview.name" class="font-normal text-muted-foreground"> · {{ preview.name }}</span></div>
            <div v-if="preview.status === 'loading'" class="p-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Finding the email in Content Builder…</div>
            <p v-else-if="preview.status === 'none'" class="p-3 text-xs text-muted-foreground">This email was not found in Content Builder.</p>
            <p v-else-if="preview.status === 'error'" class="p-3 text-xs text-red-600">Could not load the email: {{ preview.error }}</p>
            <iframe v-else :srcdoc="preview.html" sandbox class="w-full h-112 border-0 bg-white rounded-b-lg" title="Email preview" />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
