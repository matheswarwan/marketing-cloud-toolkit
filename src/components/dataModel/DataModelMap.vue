<script setup>
// One attribute group as a map (user, 2026-11-17): Data Designer's cards and links,
// left to right from the group. Hover a card to light its links and the fields they
// join on; click it to pick it (the page shows its details). Pan by dragging, zoom with
// the wheel or the buttons. Layout: utils/dataModelMap.js (layoutGroupMap).
import { computed, markRaw, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Maximize2, Minus, Plus, Map as MapIcon } from 'lucide-vue-next'
import DataModelSetNode from './DataModelSetNode.vue'
import DataModelGroupNode from './DataModelGroupNode.vue'
import DataModelEdge from './DataModelEdge.vue'
import { layoutGroupMap } from '@/utils/dataModelMap.js'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps({
  group: { type: Object, required: true },
  selected: { type: String, default: null }, // set id
  matches: { type: Object, default: null }, // Set of set ids found by search
})
const emit = defineEmits(['select'])

const flowId = `dm-map-${crypto.randomUUID()}`
const { fitView, zoomIn, zoomOut, setCenter, setViewport, onNodesInitialized, viewport } = useVueFlow(flowId)
const nodeTypes = { set: markRaw(DataModelSetNode), group: markRaw(DataModelGroupNode) }
const edgeTypes = { dm: markRaw(DataModelEdge) }
const hovered = ref(null)
const showMap = ref(false)

const laid = computed(() => layoutGroupMap(props.group))
const focus = computed(() => hovered.value || props.selected)
const lit = computed(() => {
  if (!focus.value) return null
  const edges = laid.value.edges.filter((e) => e.source === focus.value || e.target === focus.value)
  return { nodes: new Set([focus.value, ...edges.flatMap((e) => [e.source, e.target])]), edges: new Set(edges.map((e) => e.id)) }
})
const flowNodes = computed(() => laid.value.nodes.map((n) => ({
  id: n.id, type: n.kind, position: { x: n.x, y: n.y }, draggable: false, selectable: false,
  data: { ...n, selected: n.id === props.selected, dim: !!lit.value && !lit.value.nodes.has(n.id), match: !!props.matches?.has(n.id) },
})))
const flowEdges = computed(() => laid.value.edges.map((e) => ({
  id: e.id, source: e.source, target: e.target, type: 'dm',
  data: { ...e, lit: !!lit.value?.edges.has(e.id), dim: !!lit.value && !lit.value.edges.has(e.id) },
})))
const percent = computed(() => Math.round(viewport.value.zoom * 100))

let hoverTimer = null
function hover(id) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { hovered.value = id }, id ? 100 : 60) }
onBeforeUnmount(() => clearTimeout(hoverTimer))

const fit = () => fitView({ padding: 0.1, maxZoom: 1, duration: 150 })
// The first view: the whole map when its text stays readable, else the group at the left
// at a readable zoom (ckLoyalty's 14 sets on s10 fitted at 27%, too small to read).
const READABLE = 0.55
const START_ZOOM = 0.75
const root = ref(null)
function startView() {
  const el = root.value
  const { width, height } = laid.value
  const zoom = el?.clientWidth && width ? Math.min(el.clientWidth / width, el.clientHeight / height) : 1
  if (zoom >= READABLE) return fit()
  const g = laid.value.nodes.find((n) => n.kind === 'group')
  setViewport({ x: 24 - g.x * START_ZOOM, y: el.clientHeight / 2 - (g.y + g.h / 2) * START_ZOOM, zoom: START_ZOOM }, { duration: 150 })
}
onNodesInitialized(() => startView())
watch(() => props.group.id, async () => { hovered.value = null; await nextTick(); requestAnimationFrame(() => startView()) })
// A set picked from search (or the panel's links) is brought into view.
watch(() => props.selected, (id) => {
  const n = id && laid.value.nodes.find((x) => x.id === id)
  if (n) setCenter(n.x + n.w / 2, n.y + n.h / 2, { zoom: Math.max(viewport.value.zoom, 0.8), duration: 200 })
})
</script>

<template>
  <div ref="root" class="dm-map" data-dm-map>
    <VueFlow :id="flowId" :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" :edge-types="edgeTypes"
      :nodes-draggable="false" :nodes-connectable="false" :nodes-focusable="false" :edges-focusable="false"
      :elements-selectable="false" :delete-key-code="null" :selection-key-code="null" :multi-selection-key-code="null"
      :pan-on-drag="[0, 1]" :zoom-on-scroll="true" :zoom-on-double-click="false" :min-zoom="0.15" :max-zoom="2"
      :prevent-scrolling="true" @pane-click="emit('select', null)">
      <template #node-set="node"><DataModelSetNode :data="node.data" @select="(id) => emit('select', id)" @hover="hover" /></template>
      <template #node-group="node"><DataModelGroupNode :data="node.data" /></template>
      <MiniMap v-if="showMap" pannable zoomable position="bottom-right" :node-class-name="(n) => `dm-mm dm-mm-${n.type}`" />
    </VueFlow>
    <div class="dm-tools" role="group" aria-label="Map view">
      <button type="button" title="Zoom in" aria-label="Zoom in" @click="zoomIn()"><Plus class="h-3.5 w-3.5" /></button>
      <span class="dm-zoom" aria-live="polite">{{ percent }}%</span>
      <button type="button" title="Zoom out" aria-label="Zoom out" @click="zoomOut()"><Minus class="h-3.5 w-3.5" /></button>
      <button type="button" title="Fit the map" aria-label="Fit the map" @click="fit"><Maximize2 class="h-3.5 w-3.5" /></button>
      <button type="button" :title="showMap ? 'Hide the overview map' : 'Show an overview map'" :aria-pressed="showMap" @click="showMap = !showMap"><MapIcon class="h-3.5 w-3.5" /></button>
    </div>
  </div>
</template>

<style>
/* Not scoped: vue-flow renders the node components inside its own tree. */
.dm-map { position: relative; height: 100%; min-height: 420px; background: hsl(var(--muted) / 0.35); }
.dm-map .vue-flow__node-set, .dm-map .vue-flow__node-group { border: 0; padding: 0; background: none; pointer-events: all !important; }
.dm-map .vue-flow__minimap { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 6px; }
.dm-mm-set { fill: hsl(var(--primary) / 0.35); } .dm-mm-group { fill: hsl(var(--primary)); }
.dm-handle { opacity: 0; pointer-events: none; }
.dm-tools { position: absolute; left: 10px; top: 10px; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 8px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); box-shadow: 0 1px 2px rgb(0 0 0 / .06); }
.dm-tools button { display: inline-flex; padding: 5px; border-radius: 6px; color: hsl(var(--muted-foreground)); }
.dm-tools button:hover, .dm-tools button[aria-pressed="true"] { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.dm-zoom { min-width: 38px; text-align: center; font-size: 11px; color: hsl(var(--muted-foreground)); }

.dm-group { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: 9999px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); box-shadow: 0 1px 3px rgb(0 0 0 / .12); }
.dm-group-name { display: block; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-group-sub { display: block; font-size: 10px; opacity: .85; }

.dm-card { transition: opacity .15s; }
.dm-card.is-dim { opacity: .35; }
.dm-card-button { display: flex; flex-direction: column; width: 100%; height: 100%; text-align: left; overflow: hidden; border-radius: 8px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); box-shadow: 0 1px 2px rgb(0 0 0 / .06); cursor: pointer; }
.dm-card-button:hover { border-color: hsl(var(--primary) / .6); }
.dm-card-button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
.dm-card.is-selected .dm-card-button { border-color: hsl(var(--primary)); box-shadow: 0 0 0 2px hsl(var(--primary) / .35); }
.dm-card.is-match .dm-card-button { box-shadow: 0 0 0 3px rgb(250 204 21 / .7); }
.dm-card-head { display: flex; flex-direction: column; justify-content: center; height: 46px; padding: 0 10px; background: hsl(var(--primary) / .1); border-bottom: 1px solid hsl(var(--border)); }
.dm-card-name { font-weight: 600; font-size: 12.5px; color: hsl(var(--foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-card-sub { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 10px; color: hsl(var(--muted-foreground)); }
.dm-badge { padding: 0 4px; border-radius: 4px; background: hsl(var(--primary) / .15); color: hsl(var(--primary)); font-weight: 600; }
.dm-card-fields { display: flex; flex-direction: column; padding: 4px 0; }
.dm-field { display: flex; align-items: center; gap: 6px; height: 20px; padding: 0 10px; font-size: 11px; color: hsl(var(--foreground)); }
.dm-field.is-pk .dm-field-name { font-weight: 600; }
.dm-key { color: rgb(202 138 4); }
.dm-field-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-field-type { flex-shrink: 0; font-size: 10px; color: hsl(var(--muted-foreground)); }
.dm-more { color: hsl(var(--muted-foreground)); font-style: italic; }

.dm-edge .dm-line { stroke: hsl(var(--muted-foreground) / .6); stroke-width: 1.4; }
.dm-edge .dm-ends { fill: none; stroke: hsl(var(--muted-foreground) / .8); stroke-width: 1.4; }
.dm-edge.is-lit .dm-line, .dm-edge.is-lit .dm-ends { stroke: hsl(var(--primary)); stroke-width: 2; }
.dm-edge.is-dim { opacity: .25; }
.dm-edge-label { position: absolute; z-index: 4; padding: 2px 6px; border-radius: 6px; background: hsl(var(--card)); border: 1px solid hsl(var(--primary) / .4); font-size: 10.5px; line-height: 1.3; text-align: center; color: hsl(var(--foreground)); pointer-events: none; white-space: nowrap; }
.dm-edge-fields { color: hsl(var(--muted-foreground)); }
</style>
