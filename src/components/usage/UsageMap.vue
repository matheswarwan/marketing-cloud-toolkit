<script setup>
// Where used map (user, 2026-11-16): the scan's results as a flow chart around what was
// checked, data flowing left to right, the automations that run each activity in a
// band above. Model in utils/usage/graph.js, layout in graphLayout.js, picture in
// graphSvg.js.
// Hover or focus a box to light it, its neighbours and the way back to the checked
// one; click for details; double-click a data extension or automation to check it in
// turn (a new Where used check, with Back). The key filters the lines by kind.
import { computed, markRaw, nextTick, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Map as MapIcon, Maximize2, Minus, Plus, Expand, Shrink, Info, X, Network, Database, Workflow, ImageDown } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import UsageMapNode from './UsageMapNode.vue'
import UsageMapEdge from './UsageMapEdge.vue'
import UsageItemCard from './UsageItemCard.vue'
import DERowCount from '@/components/results/DERowCount.vue'
import { buildUsageMap, litSet, filterSet, DEPTHS, NODE_TYPES, EDGE_KINDS, EDGE_STATES } from '@/utils/usage/graph.js'
import { usageMapSvg, svgToPng } from '@/utils/usage/graphSvg.js'
import { saveBlob } from '@/utils/exportDoc.js'
import { layoutUsageMap, MAP_NODE_W, MAP_NODE_H } from '@/utils/usage/graphLayout.js'
import { useRouter } from 'vue-router'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps({
  input: { type: Object, required: true }, // mapInput() from the scan result
})
const emit = defineEmits(['follow'])
const router = useRouter()

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const FAR = 0.4 // below this zoom only coloured blocks are drawn
const READABLE = 0.55 // the first view fits the whole map only if its text stays readable…
const START_ZOOM = 0.6 // …else it starts here, on the checked data extension
const DEPTH_KEY = 'toolkit_usageMapDepth'
const AUTOS_KEY = 'toolkit_usageMapAutomations'
function readDepth() {
  try { const v = localStorage.getItem(DEPTH_KEY); return DEPTHS.map(String).includes(v) ? (v === 'all' ? 'all' : Number(v)) : 2 } catch { return 2 }
}
function readAutos() {
  try { return localStorage.getItem(AUTOS_KEY) !== 'off' } catch { return true }
}

const depth = ref(readDepth())
const showAutos = ref(readAutos())
const picked = ref(new Set()) // key filter: edge kinds and states
const showSave = ref(false)
const expanded = ref(new Set())
const selected = ref(null)
const hovered = ref(null)
const big = ref(false)
const showMap = ref(false)
const showKey = ref(false)
const root = ref(null)
const flowId = `usage-map-${crypto.randomUUID()}`
const { viewport, fitView, zoomIn, zoomOut, zoomTo, setViewport, getViewport, setCenter, onNodesInitialized, onPaneReady } = useVueFlow(flowId)
const nodeTypes = { usage: markRaw(UsageMapNode) }
const edgeTypes = { usage: markRaw(UsageMapEdge) }

watch(() => props.input, () => { expanded.value = new Set(); selected.value = null; hovered.value = null; picked.value = new Set() })
function setDepth(d) {
  depth.value = d
  try { localStorage.setItem(DEPTH_KEY, String(d)) } catch { /* ignore */ }
}
function toggleAutos() {
  showAutos.value = !showAutos.value
  try { localStorage.setItem(AUTOS_KEY, showAutos.value ? 'on' : 'off') } catch { /* ignore */ }
}
function togglePick(k) {
  const next = new Set(picked.value)
  next.has(k) ? next.delete(k) : next.add(k)
  picked.value = next
}

const map = computed(() => buildUsageMap(props.input, { depth: depth.value, expanded: expanded.value, automations: showAutos.value }))
const laid = computed(() => layoutUsageMap(map.value))
// Hover or selection first, else the key's filter.
const lit = computed(() => litSet(map.value, hovered.value || selected.value) || filterSet(map.value, picked.value))
const hasLineage = computed(() => props.input.edges.length > 0)
const hasAutomations = computed(() => Object.values(props.input.items).some((i) => i?.automations?.length))
const flowNodes = computed(() => laid.value.nodes.map((n) => ({
  id: n.id, type: 'usage', position: { x: n.x, y: n.y }, draggable: false, selectable: false,
  data: { ...n, selected: n.id === selected.value, dim: !!lit.value && !lit.value.nodes.has(n.id) },
})))
// Labels only while few lines are lit: on a box with dozens of links they would pile up.
const MAX_LABELS = 12
const flowEdges = computed(() => {
  const labels = !!lit.value && lit.value.edges.size <= MAX_LABELS
  return laid.value.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: 'usage',
    data: { ...e, label: labels ? e.label : '', lit: !!lit.value?.edges.has(e.id), dim: !!lit.value && !lit.value.edges.has(e.id) },
  }))
})
const percent = computed(() => Math.round(viewport.value.zoom * 100))
const far = computed(() => viewport.value.zoom < FAR)
const types = computed(() => Object.keys(NODE_TYPES).filter((t) => t !== 'more' && map.value.nodes.some((n) => n.type === t)))
const rels = computed(() => Object.keys(EDGE_KINDS).filter((r) => map.value.edges.some((e) => e.rel === r)))
const states = computed(() => Object.keys(EDGE_STATES).filter((k) => map.value.edges.some((e) => (k === 'possible' ? e.possible : e.state === k))))
const focusLabel = computed(() => props.input.focus.label)
async function savePicture(kind) {
  showSave.value = false
  const svg = usageMapSvg(laid.value, { title: `Where ${focusLabel.value} is used` })
  const name = `where-used-${String(focusLabel.value).replace(/[^\w.-]+/g, '_')}`
  if (kind === 'svg') saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
  else saveBlob(await svgToPng(svg), `${name}.png`)
}
const pick = computed(() => map.value.nodes.find((n) => n.id === selected.value) || null)

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function fit() {
  return fitView({ padding: 0.12, minZoom: MIN_ZOOM, maxZoom: 1, duration: reduceMotion() ? 0 : 200 })
}
// The view after the picture changes: the whole map when it fits readably, else the
// checked data extension at a readable zoom (in the side panel most maps are too wide).
function startView() {
  const el = root.value
  const focus = laid.value.nodes.find((n) => n.focus)
  const zoom = el ? Math.min(el.clientWidth / laid.value.width, el.clientHeight / laid.value.height) : 1
  if (!focus || !el?.clientWidth || zoom >= READABLE) return fit()
  return setCenter(focus.x + MAP_NODE_W / 2, focus.y + MAP_NODE_H / 2, { zoom: START_ZOOM, duration: reduceMotion() ? 0 : 200 })
}
// Redo it when the picture changes (new scan, depth, a "+N more" opened), not on hover
// or selection. vue-flow can only place boxes it has measured, so it waits for
// onNodesInitialized; a frame later as well, for a change that adds no new box.
let viewPending = true
let retry = null
// vue-flow can drop a view change made before its pane is ready (live test, 2026-11-16:
// the profiles map stayed at 100%), so the view is set again on pane ready and once
// more a moment later, unless the user has moved the map since.
const settle = () => {
  if (!viewPending) return
  viewPending = false
  auto = true
  startView()
  clearTimeout(retry)
  retry = setTimeout(() => { if (auto) startView() }, 350)
}
onNodesInitialized(settle)
onPaneReady(() => { if (auto) startView() })
onBeforeUnmount(() => clearTimeout(retry))
watch(() => laid.value, async () => {
  viewPending = true
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(settle))
})
// The map's box changes size (fill the window and back, the panel opening, a window
// resize): the view is set again, unless the user has panned or zoomed since (live
// test, 2026-11-16: the view was set before the new size applied and stayed small).
let auto = true
let lastSize = ''
let resizeObserver = null
/** Runs a zoom the user asked for; the view stays where they put it from then on. */
function manual(action) { auto = false; return action() }
// A wheel, or a drag that starts on the pane (not a click on a box or a button).
function userMoved(event) { if (event.type === 'wheel' || event.target?.closest?.('.vue-flow__pane')) auto = false }
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  resizeObserver = new ResizeObserver(() => {
    const el = root.value
    const size = el ? `${el.clientWidth}x${el.clientHeight}` : ''
    if (!el?.clientWidth || size === lastSize) return
    lastSize = size
    if (auto && !viewPending) requestAnimationFrame(() => startView())
  })
  resizeObserver.observe(root.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
// Filling the window moves the map into <body>, which drops the keyboard focus: put it
// back on the map, and take Escape from anywhere while it is big.
function escapeBig(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || root.value?.contains(event.target)) return
  event.preventDefault()
  big.value = false
}
watch(big, async (on) => {
  if (on) window.addEventListener('keydown', escapeBig)
  else window.removeEventListener('keydown', escapeBig)
  auto = true // the ResizeObserver sets the view once the new size applies
  await nextTick()
  root.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => window.removeEventListener('keydown', escapeBig))

// Hover lights after a short pause, so moving across the map does not flicker.
let hoverTimer = null
function hover(id) {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => { hovered.value = id }, id ? 120 : 80)
}
onBeforeUnmount(() => clearTimeout(hoverTimer))

function select(id) {
  const n = map.value.nodes.find((x) => x.id === id)
  if (!n) return
  if (n.type === 'more') {
    expanded.value = new Set([...expanded.value, id])
    selected.value = null
    return
  }
  selected.value = selected.value === id ? null : id
}
function open(id) {
  const n = map.value.nodes.find((x) => x.id === id)
  if (!n || n.focus) return
  if (n.deName) followDE(n.deName)
  else if (n.type === 'automation' && n.id.startsWith('auto:')) emit('follow', { kind: 'automation', id: n.id.slice(5), name: n.label })
  else if (n.item?.pivot) emit('follow', n.item.pivot)
}
function followDE(name) { emit('follow', { kind: 'de', de: { name } }) }

function keydown(event) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'Escape') {
    if (showSave.value) showSave.value = false
    else if (showKey.value) showKey.value = false
    else if (selected.value) selected.value = null
    else if (big.value) big.value = false
    else return
    event.preventDefault()
    return
  }
  if (event.target.closest('button')) return
  const key = event.key
  if (['+', '=', '-', '0'].includes(key) || key.startsWith('Arrow')) auto = false
  if (key === '+' || key === '=') zoomIn()
  else if (key === '-') zoomOut()
  else if (key === '1') fit()
  else if (key === '0') zoomTo(1)
  else if (key.startsWith('Arrow')) {
    const v = getViewport()
    const step = event.shiftKey ? 120 : 48
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[key]
    if (!d) return
    setViewport({ ...v, x: v.x + d[0], y: v.y + d[1] })
  } else return
  event.preventDefault()
}
</script>

<template>
  <Teleport to="body" :disabled="!big">
    <div v-if="big" class="fixed inset-0 z-[129] bg-black/40" aria-hidden="true" @click="big = false" />
    <div class="usage-map-wrap" :class="{ 'is-big': big }" :role="big ? 'dialog' : undefined" :aria-modal="big ? 'true' : undefined" :aria-label="big ? 'Where used map' : undefined">
      <div ref="root" class="usage-map" :class="{ 'is-far': far, 'is-lit': !!lit }" tabindex="0" role="region" aria-label="Where used map" :aria-describedby="`${flowId}-help`" @keydown="keydown" @wheel.passive="userMoved" @pointerdown="userMoved">
        <VueFlow :id="flowId" :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" :edge-types="edgeTypes"
          :nodes-draggable="false" :nodes-connectable="false" :nodes-focusable="false" :edges-focusable="false"
          :elements-selectable="false" :delete-key-code="null" :selection-key-code="null" :multi-selection-key-code="null"
          :pan-on-drag="[0, 1]" :zoom-on-scroll="true" :zoom-on-pinch="true" :zoom-on-double-click="false"
          :min-zoom="MIN_ZOOM" :max-zoom="MAX_ZOOM" :disable-keyboard-a11y="true" :prevent-scrolling="true"
          @pane-click="selected = null">
          <template #node-usage="node">
            <UsageMapNode :data="node.data" @select="select" @open="open" @hover="hover" />
          </template>
          <!-- Coloured by class: a CSS variable does not work in the fill attribute. -->
          <MiniMap v-if="showMap" pannable zoomable position="bottom-right" :node-class-name="(n) => `umap-mm umap-mm-${n.data.type}${n.data.focus ? ' is-focus' : ''}`" />
        </VueFlow>

        <div class="usage-map-toolbar nopan nowheel" role="toolbar" aria-label="Map controls">
          <template v-if="hasLineage">
            <div class="flex rounded-md border border-border" role="group" aria-label="Levels: how many data extensions away" title="Levels: how many data extensions away">
              <button v-for="d in DEPTHS" :key="d" type="button" class="h-7 min-w-[34px] px-2 text-xs font-semibold first:rounded-l-md last:rounded-r-md"
                :class="depth === d ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'" :aria-pressed="depth === d"
                :title="d === 'all' ? 'Every level found (up to 6)' : `${d} data extension${d === 1 ? '' : 's'} away`" @click="setDepth(d)">{{ d === 'all' ? 'All' : d }}</button>
            </div>
            <span class="usage-map-divider" aria-hidden="true" />
          </template>
          <Button v-if="hasAutomations" variant="ghost" size="icon" aria-label="Show the automations that run each activity" title="Automations above their steps"
            :aria-pressed="showAutos" :class="{ 'bg-accent': showAutos }" @click="toggleAutos"><Workflow class="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out (−)" @click="manual(zoomOut)"><Minus class="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" class="w-[48px] px-1 tabular-nums" aria-label="Reset zoom to 100 percent" title="Reset to 100% (0)" @click="manual(() => zoomTo(1))">{{ percent }}%</Button>
          <Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in (+)" @click="manual(zoomIn)"><Plus class="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Fit the map" title="Fit (1)" @click="fit"><Maximize2 class="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Toggle minimap" title="Minimap" :aria-pressed="showMap" @click="showMap = !showMap"><MapIcon class="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Show the key" title="Key and filter" :aria-expanded="showKey" :class="{ 'bg-accent': picked.size }" @click="showKey = !showKey"><Info class="h-4 w-4" /></Button>
        </div>
        <!-- Top right, so the bottom toolbar fits on one line in the side panel. -->
        <div class="usage-map-corner nopan nowheel" role="toolbar" aria-label="Map picture and size">
          <div class="relative">
            <Button variant="ghost" size="icon" aria-label="Download the map as a picture" title="Download picture" :aria-expanded="showSave" @click="showSave = !showSave"><ImageDown class="h-4 w-4" /></Button>
            <div v-if="showSave" class="usage-map-menu" role="menu">
              <button type="button" role="menuitem" @click="savePicture('png')">PNG picture</button>
              <button type="button" role="menuitem" @click="savePicture('svg')">SVG (scales, opens in a browser)</button>
            </div>
          </div>
          <Button variant="ghost" size="icon" :aria-label="big ? 'Back to the panel' : 'Fill the window'" :title="big ? 'Back to the panel (Escape)' : 'Fill the window'" @click="big = !big">
            <Shrink v-if="big" class="h-4 w-4" /><Expand v-else class="h-4 w-4" />
          </Button>
        </div>

        <div v-if="showKey" class="usage-map-key nopan nowheel" role="dialog" aria-label="Map key">
          <div class="flex items-center justify-between gap-2">
            <strong class="text-xs">How to read the map</strong>
            <button type="button" class="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent" aria-label="Close the key" @click="showKey = false"><X class="h-3.5 w-3.5" /></button>
          </div>
          <p class="text-muted-foreground">Data flows left to right; automations sit above the steps they run. What was checked has the blue ring.</p>
          <ul class="grid grid-cols-2 gap-x-3 gap-y-1">
            <li v-for="t in types" :key="t" class="flex items-center gap-1.5"><span class="umap-key-dot" :style="{ background: `hsl(var(--umap-${t}))` }" />{{ NODE_TYPES[t].label }}</li>
          </ul>
          <ul class="grid gap-0.5" aria-label="Show only lines of a kind">
            <li v-for="r in rels" :key="r"><button type="button" class="umap-key-item" :aria-pressed="picked.has(r)" @click="togglePick(r)">
              <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" class="umap-key-line" :data-rel="r" /></svg>{{ EDGE_KINDS[r].key }}</button></li>
            <li v-for="k in states" :key="k"><button type="button" class="umap-key-item" :aria-pressed="picked.has(k)" @click="togglePick(k)">
              <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" class="umap-key-line" :class="{ 'is-possible': k === 'possible' }" :data-state="k === 'possible' ? undefined : k" data-rel="uses" /></svg>{{ EDGE_STATES[k].key }}</button></li>
          </ul>
          <p class="text-muted-foreground">Click a line kind to light only those lines<template v-if="picked.size"> (<button type="button" class="text-primary hover:underline" @click="picked = new Set()">show all</button>)</template>. Hover a box to light its links, click it for details, double-click a data extension or automation to check it in turn.</p>
        </div>
        <p v-if="map.nodes.length === 1" class="usage-map-empty" role="status">Nothing that uses it was found, so the map has only {{ focusLabel }}.</p>
        <p :id="`${flowId}-help`" class="sr-only">Flow chart of where {{ focusLabel }} is used. Tab to a box and press Enter for its details. Plus and minus zoom, 1 fits, arrow keys pan, Escape clears the selection.</p>
      </div>

      <p class="usage-map-status">
        {{ map.nodes.length }} boxes<template v-if="map.hidden"> · {{ map.hidden }} more folded away (click a “+ more” box)</template>.
        Double-click a data extension or automation to check it in turn.
      </p>

      <!-- Details of the clicked box -->
      <div v-if="pick && !pick.focus" class="usage-map-details">
        <UsageItemCard v-if="pick.item" :item="pick.item" @follow="emit('follow', $event)" />
        <div v-else-if="pick.deName" class="rounded-xl border border-border bg-card p-3 text-xs flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"><Database class="h-3 w-3" />{{ NODE_TYPES[pick.type].label }}</span>
          <button v-if="pick.type === 'de'" class="font-semibold text-sm text-primary hover:underline text-left" data-open-de :title="`Open ${pick.deName} on Data Extensions`"
            @click="router.push(`/data-extensions?q=${encodeURIComponent(pick.deName)}`)">{{ pick.label }}</button>
          <span v-else class="font-semibold text-sm">{{ pick.label }}</span>
          <DERowCount v-if="pick.type === 'de'" :name="pick.deName" />
          <div class="flex-1" />
          <button class="inline-flex items-center gap-0.5 text-primary hover:underline" :title="`Where is ${pick.deName} used?`" @click="followDE(pick.deName)"><Network class="h-3 w-3" /> Where used</button>
        </div>
        <div v-else class="rounded-xl border border-border bg-card p-3 text-xs">
          <span class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ NODE_TYPES[pick.type]?.label }}</span>
          <p class="font-semibold text-sm break-all">{{ pick.label }}</p>
          <p class="text-muted-foreground">{{ pick.sub }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.usage-map-wrap { display: flex; flex-direction: column; gap: 8px; }
.usage-map-wrap.is-big { position: fixed; inset: 16px; z-index: 130; padding: 12px; border-radius: 14px; background: hsl(var(--card)); box-shadow: 0 10px 40px rgb(0 0 0 / .25); }
.usage-map {
  --umap-de: 186 72% 30%; --umap-dataview: 215 20% 40%; --umap-query: 221 83% 53%; --umap-filter: 220 9% 46%;
  --umap-import: 32 95% 40%; --umap-extract: 85 70% 30%; --umap-file: 25 6% 45%; --umap-script: 262 83% 58%;
  --umap-send: 330 81% 50%; --umap-event: 21 90% 48%; --umap-journey: 142 72% 30%; --umap-content: 200 98% 39%; --umap-more: var(--muted-foreground);
  --umap-field: 186 72% 30%; --umap-transfer: 32 95% 40%; --umap-location: 25 6% 45%; --umap-automation: 12 72% 44%; --umap-step: 215 25% 45%; --umap-profile: 215 25% 45%;
  --umap-reads: 199 89% 42%; --umap-writes: 32 95% 42%; --umap-uses: 262 70% 58%; --umap-entry: 142 72% 32%; --umap-filerel: 25 6% 50%;
  --umap-sends: 330 81% 50%; --umap-runs: 215 20% 55%; --umap-paused: 38 92% 45%; --umap-error: 0 72% 50%;
  position: relative; width: 100%; height: clamp(360px, 58vh, 640px); overflow: hidden;
  border: 1px solid hsl(var(--border)); border-radius: 10px; background-color: hsl(var(--card));
  background-image: radial-gradient(hsl(var(--border)) 1px, transparent 1.2px); background-size: 18px 18px;
}
.dark .usage-map {
  --umap-de: 186 70% 55%; --umap-dataview: 215 20% 65%; --umap-query: 217 91% 68%; --umap-filter: 220 9% 65%;
  --umap-import: 38 92% 55%; --umap-extract: 84 70% 50%; --umap-file: 30 6% 65%; --umap-script: 263 85% 74%;
  --umap-send: 330 85% 68%; --umap-event: 24 95% 60%; --umap-journey: 142 65% 50%; --umap-content: 199 90% 60%;
  --umap-reads: 199 90% 60%; --umap-writes: 38 92% 55%; --umap-uses: 263 85% 74%; --umap-entry: 142 65% 50%; --umap-filerel: 30 6% 60%;
  --umap-field: 186 70% 55%; --umap-transfer: 38 92% 55%; --umap-location: 30 6% 65%; --umap-automation: 14 85% 62%; --umap-step: 215 20% 65%; --umap-profile: 215 20% 65%;
  --umap-sends: 330 85% 68%; --umap-runs: 215 20% 60%; --umap-paused: 38 92% 55%; --umap-error: 0 80% 62%;
}
.usage-map-wrap.is-big .usage-map { flex: 1; height: auto; }
.usage-map:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
.usage-map .vue-flow__pane { cursor: grab; }
.usage-map .vue-flow__pane.dragging { cursor: grabbing; }
/* vue-flow sets pointer-events: none on nodes that are neither selectable nor draggable
   and have no node-click listener on <VueFlow>; the boxes handle their own clicks. */
.usage-map .vue-flow__node-usage { border: 0; padding: 0; background: none; pointer-events: all !important; }
.usage-map-status { font-size: 11px; color: hsl(var(--muted-foreground)); }
.usage-map-empty { position: absolute; left: 50%; top: 18px; z-index: 4; max-width: calc(100% - 140px); padding: 6px 10px; border-radius: 8px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); font-size: 12px; transform: translateX(-50%); }
.usage-map-details { max-height: 40vh; overflow-y: auto; }
.usage-map-wrap.is-big .usage-map-details { max-height: 30vh; }

/* Boxes */
.umap-node { --t: var(--umap-more); width: 220px; height: 52px; transition: opacity .15s; }
.umap-node[data-type="de"] { --t: var(--umap-de); } .umap-node[data-type="dataview"] { --t: var(--umap-dataview); }
.umap-node[data-type="query"] { --t: var(--umap-query); } .umap-node[data-type="filter"] { --t: var(--umap-filter); }
.umap-node[data-type="import"] { --t: var(--umap-import); } .umap-node[data-type="extract"] { --t: var(--umap-extract); }
.umap-node[data-type="file"] { --t: var(--umap-file); } .umap-node[data-type="script"] { --t: var(--umap-script); }
.umap-node[data-type="send"] { --t: var(--umap-send); } .umap-node[data-type="event"] { --t: var(--umap-event); }
.umap-node[data-type="journey"] { --t: var(--umap-journey); } .umap-node[data-type="content"] { --t: var(--umap-content); }
.umap-node[data-type="field"] { --t: var(--umap-field); } .umap-node[data-type="transfer"] { --t: var(--umap-transfer); }
.umap-node[data-type="location"] { --t: var(--umap-location); } .umap-node[data-type="automation"] { --t: var(--umap-automation); }
.umap-node[data-type="step"] { --t: var(--umap-step); } .umap-node[data-type="profile"] { --t: var(--umap-profile); }
.umap-handle { opacity: 0; pointer-events: none; width: 1px !important; height: 1px !important; min-width: 0 !important; border: 0 !important; }
.umap-node-button {
  display: flex; align-items: center; gap: 9px; width: 100%; height: 100%; padding: 0 12px 0 9px; text-align: left;
  border: 1px solid hsl(var(--t) / .5); border-radius: 10px; background: hsl(var(--card)); color: hsl(var(--foreground));
  box-shadow: 0 1px 2px rgb(0 0 0 / .06); cursor: pointer; transition: box-shadow .15s, border-color .15s;
}
.umap-node-button:hover { box-shadow: 0 2px 8px rgb(0 0 0 / .12); border-color: hsl(var(--t)); }
.umap-node-button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
.umap-node[data-type="de"] .umap-node-button, .umap-node[data-type="dataview"] .umap-node-button { border-radius: 26px; background: linear-gradient(hsl(var(--t) / .07), hsl(var(--t) / .07)), hsl(var(--card)); padding-left: 10px; }
.umap-node:is([data-type="query"], [data-type="filter"], [data-type="import"], [data-type="extract"], [data-type="transfer"], [data-type="script"], [data-type="send"], [data-type="step"]) .umap-node-button { border-radius: 4px; }
.umap-node[data-type="automation"] .umap-node-button { background: linear-gradient(hsl(var(--t) / .06), hsl(var(--t) / .06)), hsl(var(--card)); }
.umap-node[data-state="paused"] .umap-node-button { border: 1px dashed hsl(var(--umap-paused)); }
.umap-node[data-state="paused"] .umap-chip { opacity: .55; }
.umap-node[data-state="error"] .umap-node-button { border: 2px solid hsl(var(--umap-error)); }
.umap-node.is-ghost .umap-node-button { border-style: dashed; border-color: hsl(var(--muted-foreground) / .5); background: hsl(var(--muted) / .5); }
.umap-node.is-ghost .umap-chip { opacity: .5; }
.umap-node.is-ghost .umap-sub { font-style: italic; }
.umap-chip { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: hsl(var(--t) / .14); color: hsl(var(--t)); }
.umap-node[data-type="de"] .umap-chip, .umap-node[data-type="dataview"] .umap-chip { border-radius: 50%; }
.umap-text { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.umap-name { overflow: hidden; font-size: 12.5px; font-weight: 600; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.umap-sub { overflow: hidden; color: hsl(var(--muted-foreground)); font-size: 11px; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; }
.umap-node.is-focus .umap-node-button { border: 2px solid hsl(var(--primary)); background: linear-gradient(hsl(var(--primary) / .08), hsl(var(--primary) / .08)), hsl(var(--card)); box-shadow: 0 0 0 4px hsl(var(--primary) / .15); }
.umap-node.is-selected .umap-node-button { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; }
.umap-node.is-possible .umap-node-button { border-style: dashed; }
.umap-node.is-possible .umap-chip { opacity: .7; }
.umap-node.is-more .umap-node-button { border: 1px dashed hsl(var(--primary) / .6); background: hsl(var(--card)); }
.umap-node.is-more .umap-name { color: hsl(var(--primary)); }
.umap-node.is-dim { opacity: .22; }

/* Lines */
.umap-edge { --e: var(--umap-reads); transition: opacity .15s; }
.umap-edge[data-rel="writes"] { --e: var(--umap-writes); } .umap-edge[data-rel="uses"] { --e: var(--umap-uses); }
.umap-edge[data-rel="entry"] { --e: var(--umap-entry); } .umap-edge[data-rel="file"] { --e: var(--umap-filerel); }
.umap-edge[data-rel="sends"] { --e: var(--umap-sends); } .umap-edge[data-rel="runs"] { --e: var(--umap-runs); }
.umap-edge[data-state="paused"] { --e: var(--umap-paused); } .umap-edge[data-state="error"] { --e: var(--umap-error); }
.usage-map .umap-line { stroke: hsl(var(--e) / .75); stroke-width: 1.4; fill: none; vector-effect: non-scaling-stroke; }
.usage-map .umap-arrow { fill: hsl(var(--e) / .85); }
.usage-map .umap-edge.is-possible .umap-line { stroke-dasharray: 6 4; }
.usage-map .umap-edge.is-back .umap-line, .usage-map .umap-edge[data-state] .umap-line { stroke-dasharray: 2 4; }
/* Automation lines cross the map from the band: quiet until lit. */
.usage-map .umap-edge[data-rel="runs"]:not(.is-lit) { opacity: .45; }
.usage-map .umap-edge.is-lit .umap-line { stroke: hsl(var(--e)); stroke-width: 2.4; }
.usage-map .umap-edge.is-dim { opacity: .1; }
.umap-edge-label { position: absolute; z-index: 2; padding: 0 7px; border-radius: 8px; background: hsl(var(--card)); color: hsl(var(--foreground)); font-size: 10px; line-height: 16px; white-space: nowrap; pointer-events: none; box-shadow: 0 0 0 1px hsl(var(--border)); }

/* Far out: coloured blocks, no text */
.usage-map.is-far .umap-text, .usage-map.is-far .umap-chip > * { visibility: hidden; }
.usage-map.is-far .umap-node-button { background: hsl(var(--t) / .55); border-color: hsl(var(--t)); }
.usage-map.is-far .umap-node.is-focus .umap-node-button { background: hsl(var(--primary)); }
.usage-map.is-far .umap-edge:not(.is-lit) .umap-line { stroke: hsl(var(--muted-foreground) / .35); }
.usage-map.is-far .umap-edge:not(.is-lit) .umap-arrow { display: none; }

/* Toolbar, key, minimap */
.usage-map-toolbar { position: absolute; bottom: 10px; left: 10px; right: auto; max-width: calc(100% - 20px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); box-shadow: 0 2px 8px rgb(0 0 0 / .08); }
.usage-map-divider { height: 20px; width: 1px; margin: 0 4px; background: hsl(var(--border)); }
.usage-map-key { position: absolute; bottom: 58px; left: 10px; max-height: calc(100% - 70px); overflow-y: auto; z-index: 6; display: grid; gap: 8px; width: min(340px, calc(100% - 20px)); padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); font-size: 12px; box-shadow: 0 2px 8px rgb(0 0 0 / .1); }
.umap-key-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.umap-key-line { --e: var(--umap-reads); stroke: hsl(var(--e)); stroke-width: 2; }
.umap-key-line[data-rel="writes"] { --e: var(--umap-writes); } .umap-key-line[data-rel="uses"] { --e: var(--umap-uses); }
.umap-key-line[data-rel="entry"] { --e: var(--umap-entry); } .umap-key-line[data-rel="file"] { --e: var(--umap-filerel); }
.umap-key-line[data-rel="sends"] { --e: var(--umap-sends); } .umap-key-line[data-rel="runs"] { --e: var(--umap-runs); }
.umap-key-line[data-state="paused"] { --e: var(--umap-paused); stroke-dasharray: 2 4; } .umap-key-line[data-state="error"] { --e: var(--umap-error); stroke-dasharray: 2 4; }
.umap-key-line.is-possible { stroke-dasharray: 6 4; }
.umap-key-item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 2px 6px; border-radius: 6px; text-align: left; }
.umap-key-item:hover { background: hsl(var(--accent)); }
.umap-key-item[aria-pressed="true"] { background: hsl(var(--primary) / .12); font-weight: 600; }
.usage-map-corner { position: absolute; top: 10px; right: 10px; z-index: 5; display: flex; gap: 2px; padding: 4px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); box-shadow: 0 2px 8px rgb(0 0 0 / .08); }
.usage-map-menu { position: absolute; top: 40px; right: 0; z-index: 7; display: grid; min-width: 220px; padding: 4px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); font-size: 12px; box-shadow: 0 2px 8px rgb(0 0 0 / .12); }
.usage-map-menu button { padding: 6px 10px; border-radius: 6px; text-align: left; }
.usage-map-menu button:hover { background: hsl(var(--accent)); }
.usage-map .vue-flow__minimap { width: 160px; height: 100px; margin: 10px; border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--card)); }
.usage-map .vue-flow__minimap-mask { fill: hsl(var(--muted) / .6); }
.usage-map .umap-mm { fill: hsl(var(--umap-more)); }
.usage-map .umap-mm-de { fill: hsl(var(--umap-de)); } .usage-map .umap-mm-dataview { fill: hsl(var(--umap-dataview)); }
.usage-map .umap-mm-query { fill: hsl(var(--umap-query)); } .usage-map .umap-mm-filter { fill: hsl(var(--umap-filter)); }
.usage-map .umap-mm-import { fill: hsl(var(--umap-import)); } .usage-map .umap-mm-extract { fill: hsl(var(--umap-extract)); }
.usage-map .umap-mm-file { fill: hsl(var(--umap-file)); } .usage-map .umap-mm-script { fill: hsl(var(--umap-script)); }
.usage-map .umap-mm-send { fill: hsl(var(--umap-send)); } .usage-map .umap-mm-event { fill: hsl(var(--umap-event)); }
.usage-map .umap-mm-journey { fill: hsl(var(--umap-journey)); } .usage-map .umap-mm-content { fill: hsl(var(--umap-content)); }
.usage-map .umap-mm-field { fill: hsl(var(--umap-field)); } .usage-map .umap-mm-transfer { fill: hsl(var(--umap-transfer)); }
.usage-map .umap-mm-location { fill: hsl(var(--umap-location)); } .usage-map .umap-mm-automation { fill: hsl(var(--umap-automation)); }
.usage-map .umap-mm-step { fill: hsl(var(--umap-step)); } .usage-map .umap-mm-profile { fill: hsl(var(--umap-profile)); }
.usage-map .umap-mm.is-focus { fill: hsl(var(--primary)); }
@media (prefers-reduced-motion: reduce) { .umap-node, .umap-edge, .umap-node-button { transition: none; } }
@media (forced-colors: active) { .usage-map .umap-line { stroke: CanvasText; } .usage-map .umap-arrow { fill: CanvasText; } .umap-node.is-focus .umap-node-button { border-color: Highlight; } }
</style>
