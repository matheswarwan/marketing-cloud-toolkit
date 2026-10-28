<script setup>
// Visual Query Builder: the List view's model drawn as cards and lines (Vue Flow).
// Drag from a field to a field on another card to join them; tick fields for the
// output; click a join's pill to edit it. Card positions are kept in `layout`.
import { computed, nextTick, provide, ref, watch } from 'vue'
import { VueFlow, Panel, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { Network, Maximize2, Map as MapIcon, X, Plus, Code2, Wand2, Braces } from 'lucide-vue-next'
import DENode from './DENode.vue'
import JoinEdge from './JoinEdge.vue'
import {
  canvasEdges, autoLayout, nextPosition, joinedFields, parseHandle, cardHeight, visibleRows, JOIN_TYPES,
} from '@/utils/builderCanvas.js'
import { addJoinCondition, orderFromRoot, joinsForOrder } from '@/utils/builderOrder.js'
import { aliasOf, suggestJoinConditions } from '@/utils/sqlBuilder.js'

const props = defineProps({
  selectedDEs: { type: Array, default: () => [] },
  joins: { type: Array, default: () => [] },
  layout: { type: Object, default: () => ({}) },
  where: { type: Object, default: () => ({ combinator: 'AND', conditions: [] }) },
})
const emit = defineEmits(['update:selectedDEs', 'update:joins', 'update:layout', 'add-de', 'add-filter', 'edit-subquery'])

const flowId = `qb-canvas-${Math.random().toString(36).slice(2, 8)}`
const { fitView, project, vueFlowRef, findNode } = useVueFlow(flowId)

const OPERATORS = ['=', '<>', '>', '<', '>=', '<=']
const showMap = ref(localStorage.getItem('qb_canvas_minimap') !== '0')
watch(showMap, (v) => { try { localStorage.setItem('qb_canvas_minimap', v ? '1' : '0') } catch { /* ignore */ } })

// ── Nodes and edges from the model ─────────────────────────
const joinedMap = computed(() => joinedFields(props.selectedDEs, props.joins))
const filteredMap = computed(() => {
  const byAlias = new Map(props.selectedDEs.map((d, i) => [aliasOf(d, i), d.id]))
  const out = {}
  const walk = (g) => (g?.conditions || []).forEach((c) => {
    if (c?.conditions) return walk(c)
    const id = byAlias.get(c?.alias)
    if (id && c.field) (out[id] ||= []).push(c.field)
  })
  walk(props.where)
  return out
})

const nodes = computed(() => props.selectedDEs.map((de, index) => ({
  id: de.id,
  type: 'de',
  position: props.layout[de.id] || { x: 40 + index * 360, y: 40 },
  dragHandle: '.de-node-header',
  data: {
    de,
    index,
    alias: aliasOf(de, index),
    joined: [...(joinedMap.value.get(de.id) || [])],
    filtered: filteredMap.value[de.id] || [],
  },
})))
const edges = computed(() => canvasEdges(props.selectedDEs, props.joins, props.layout))

// New tables get a position: a dropped one where it was dropped, else auto layout when
// several arrive at once (restored or imported), else right of the others.
const dropPositions = new Map()
watch(() => props.selectedDEs.map((d) => d.id).join('|'), () => {
  const missing = props.selectedDEs.filter((d) => !props.layout[d.id])
  if (!missing.length) return
  // Laid out once the joins have arrived and the cards have their real sizes.
  if (missing.length > 1 && missing.length === props.selectedDEs.length) return setTimeout(runAutoLayout, 80)
  const next = { ...props.layout }
  for (const d of missing) {
    next[d.id] = dropPositions.get(d.id) || nextPosition(next)
    dropPositions.delete(d.id)
  }
  emit('update:layout', next)
}, { immediate: true })

function heights() {
  const out = {}
  for (const d of props.selectedDEs) {
    const h = findNode(d.id)?.dimensions?.height
    const v = visibleRows(d, joinedMap.value.get(d.id))
    out[d.id] = h || cardHeight(v.rows.length, v.hidden)
  }
  return out
}
function runAutoLayout() {
  openJoinId.value = null
  emit('update:layout', autoLayout(props.selectedDEs, props.joins, heights()))
  nextTick(() => setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 30))
}
function fit() { fitView({ padding: 0.15, duration: 200 }) }
defineExpose({ autoLayout: runAutoLayout, fit })

function onNodeDragStop({ nodes: moved }) {
  const next = { ...props.layout }
  for (const n of moved || []) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
  emit('update:layout', next)
}

// ── Drawing a join ─────────────────────────────────────────
const fieldName = (deId, handle) => {
  const i = parseHandle(handle)
  return i === null ? null : props.selectedDEs.find((d) => d.id === deId)?.fields?.[i]?.name || null
}
function isValidConnection(c) {
  return c.source !== c.target && parseHandle(c.sourceHandle) !== null && parseHandle(c.targetHandle) !== null
}
function onConnect(c) {
  const a = fieldName(c.source, c.sourceHandle)
  const b = fieldName(c.target, c.targetHandle)
  if (!a || !b || c.source === c.target) return
  emit('update:joins', addJoinCondition(props.selectedDEs, props.joins, { deId: c.source, field: a }, { deId: c.target, field: b }))
}

// ── Card actions (provided to DENode and JoinEdge) ─────────
function toggleField(deId, name) {
  const next = props.selectedDEs.map((de) => {
    if (de.id !== deId) return de
    const all = (de.fields || []).map((f) => f.name)
    const set = new Set(de.selectedFields === null ? all : de.selectedFields || [])
    set.has(name) ? set.delete(name) : set.add(name)
    return { ...de, selectedFields: set.size === all.length ? null : all.filter((n) => set.has(n)) }
  })
  emit('update:selectedDEs', next)
}
function remove(deId) {
  if (openJoinId.value === deId) openJoinId.value = null
  emit('update:selectedDEs', props.selectedDEs.filter((d) => d.id !== deId))
}
function makeFrom(deId) {
  const list = orderFromRoot(props.selectedDEs, props.joins, deId)
  emit('update:joins', joinsForOrder(list, props.joins))
  emit('update:selectedDEs', list)
}
function addFilter(deId, field) {
  const i = props.selectedDEs.findIndex((d) => d.id === deId)
  if (i >= 0) emit('add-filter', { alias: aliasOf(props.selectedDEs[i], i), field })
}

// ── Join editor ────────────────────────────────────────────
const wrapRef = ref(null)
const openJoinId = ref(null) // rightDeId of the join being edited
const editorPos = ref({ x: 0, y: 0 })
function openJoin(rightDeId, e) {
  const r = wrapRef.value?.getBoundingClientRect()
  if (r && e) {
    editorPos.value = {
      x: Math.min(Math.max(8, e.clientX - r.left - 170), Math.max(8, r.width - 348)),
      y: Math.min(e.clientY - r.top + 14, Math.max(8, r.height - 300)),
    }
  }
  openJoinId.value = rightDeId
}
function onEdgeClick({ edge, event }) { if (edge?.data?.rightDeId) openJoin(edge.data.rightDeId, event) }
provide('builderCanvas', { toggleField, remove, makeFrom, addFilter, openJoin, openJoinId, editSubquery: (id) => emit('edit-subquery', id) })

const editIdx = computed(() => props.joins.findIndex((j) => j.rightDeId === openJoinId.value))
const editJoin = computed(() => (editIdx.value >= 0 ? props.joins[editIdx.value] : null))
const deIndex = (id) => props.selectedDEs.findIndex((d) => d.id === id)
const deById = (id) => props.selectedDEs.find((d) => d.id === id)
const label = (id) => { const i = deIndex(id); return i < 0 ? '?' : `${aliasOf(props.selectedDEs[i], i)} · ${props.selectedDEs[i].name}` }
const earlierTables = computed(() => {
  const i = deIndex(openJoinId.value)
  return i <= 0 ? [] : props.selectedDEs.slice(0, i)
})
const fieldsOf = (id) => (deById(id)?.fields || []).map((f) => f.name)

function patchJoin(patch) {
  const next = props.joins.map((j, i) => (i === editIdx.value ? { ...j, ...patch } : j))
  emit('update:joins', next)
}
function patchCond(ci, key, v) {
  patchJoin({ conditions: editJoin.value.conditions.map((c, i) => (i === ci ? { ...c, [key]: v } : c)) })
}
function addCond() {
  patchJoin({ conditions: [...(editJoin.value.conditions || []), { leftField: '', operator: '=', rightField: '', conn: 'AND' }] })
}
function removeCond(ci) { patchJoin({ conditions: editJoin.value.conditions.filter((_, i) => i !== ci) }) }
function setLeft(id) { patchJoin({ leftDeId: id, conditions: [] }) }
const suggestion = computed(() => {
  if (!editJoin.value) return []
  return suggestJoinConditions(deById(editJoin.value.leftDeId), deById(editJoin.value.rightDeId))
})
function acceptSuggestion() {
  patchJoin({ conditions: suggestion.value.map((c) => ({ ...c, conn: 'AND' })) })
}

// ── Drop from the DE browser ───────────────────────────────
const dropHover = ref(false)
function onDragOver(e) {
  if (Array.from(e.dataTransfer?.types || []).includes('application/x-sfmc-de')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    dropHover.value = true
  }
}
function onDrop(e) {
  dropHover.value = false
  const raw = e.dataTransfer?.getData('application/x-sfmc-de')
  if (!raw) return
  e.preventDefault()
  let de
  try { de = JSON.parse(raw) } catch { return }
  if (!de?.id || props.selectedDEs.some((d) => d.id === de.id)) return
  const r = vueFlowRef.value?.getBoundingClientRect()
  if (r) {
    const p = project({ x: e.clientX - r.left, y: e.clientY - r.top })
    dropPositions.set(de.id, { x: Math.round(p.x - 120), y: Math.round(p.y - 20) })
  }
  emit('add-de', de)
}
</script>

<template>
  <div
    ref="wrapRef"
    class="qb-canvas relative flex-1 min-h-[300px]"
    :class="dropHover ? 'ring-2 ring-inset ring-primary/40' : ''"
    @dragover="onDragOver"
    @dragleave="dropHover = false"
    @drop="onDrop"
  >
    <VueFlow
      :id="flowId"
      :nodes="nodes"
      :edges="edges"
      :node-types="{ de: DENode }"
      :edge-types="{ join: JoinEdge }"
      connection-mode="loose"
      :is-valid-connection="isValidConnection"
      :delete-key-code="null"
      :min-zoom="0.2"
      :max-zoom="2"
      :snap-to-grid="true"
      :snap-grid="[10, 10]"
      :connection-line-options="{ style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 } }"
      fit-view-on-init
      @connect="onConnect"
      @node-drag-stop="onNodeDragStop"
      @edge-click="onEdgeClick"
      @pane-click="openJoinId = null"
    >
      <Background pattern-color="hsl(var(--muted-foreground) / 0.35)" :gap="18" />
      <Controls :show-interactive="false" position="bottom-left" />
      <MiniMap v-if="showMap" pannable zoomable position="bottom-right" :node-color="() => 'hsl(var(--primary) / 0.35)'" />
      <Panel position="top-left" class="flex items-center gap-1">
        <button class="qb-tool" title="Arrange the cards along the joins" :disabled="!selectedDEs.length" @click="runAutoLayout"><Network class="h-3.5 w-3.5" /> Auto layout</button>
        <button class="qb-tool" title="Fit every card in view" @click="fit"><Maximize2 class="h-3.5 w-3.5" /> Fit</button>
        <button class="qb-tool" :class="showMap ? 'qb-tool-on' : ''" title="Show or hide the minimap" @click="showMap = !showMap"><MapIcon class="h-3.5 w-3.5" /> Map</button>
        <button class="qb-tool" title="Add a subquery as a table (SELECT ... in parentheses in FROM)" @click="emit('edit-subquery', null)"><Braces class="h-3.5 w-3.5" /> Subquery</button>
        <slot name="tools" />
      </Panel>
    </VueFlow>

    <div v-if="!selectedDEs.length" class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="max-w-sm text-center text-xs text-muted-foreground px-6">
        Drag data extensions or data views here (or click them on the left). Then drag from a field on one card to a field on another to join them, and tick the fields you want in the output.
      </div>
    </div>

    <!-- Join editor -->
    <div
      v-if="editJoin"
      class="absolute z-20 w-[340px] rounded-lg border border-border bg-card text-card-foreground shadow-xl p-2.5 text-[11px]"
      :style="{ left: editorPos.x + 'px', top: editorPos.y + 'px' }"
      @click.stop
    >
      <div class="flex items-center gap-2 mb-2">
        <select class="border border-border rounded px-1 py-0.5 bg-background font-semibold" :value="editJoin.joinType || 'INNER JOIN'" @change="patchJoin({ joinType: $event.target.value })">
          <option v-for="jt in JOIN_TYPES" :key="jt.value" :value="jt.value">{{ jt.value }}</option>
        </select>
        <span class="truncate font-bold" :title="label(editJoin.rightDeId)">{{ label(editJoin.rightDeId) }}</span>
        <button class="ml-auto text-muted-foreground hover:text-foreground" title="Close" @click="openJoinId = null"><X class="h-3.5 w-3.5" /></button>
      </div>
      <div class="flex items-center gap-1 mb-2">
        <span class="text-muted-foreground shrink-0">joins to</span>
        <select v-if="earlierTables.length > 1" class="flex-1 min-w-0 border border-border rounded px-1 py-0.5 bg-background" :value="editJoin.leftDeId" @change="setLeft($event.target.value)">
          <option v-for="t in earlierTables" :key="t.id" :value="t.id">{{ label(t.id) }}</option>
        </select>
        <span v-else class="truncate">{{ label(editJoin.leftDeId) }}</span>
      </div>

      <template v-if="!editJoin.rawOn">
        <div v-for="(c, ci) in editJoin.conditions" :key="ci" class="flex items-center gap-1 mb-1">
          <select v-if="ci > 0" class="w-12 border border-border rounded px-0.5 py-0.5 bg-background text-muted-foreground" :value="c.conn || editJoin.combinator || 'AND'" @change="patchCond(ci, 'conn', $event.target.value)">
            <option>AND</option><option>OR</option>
          </select>
          <span v-else class="w-12 text-center text-[9px] text-muted-foreground">ON</span>
          <select class="flex-1 min-w-0 border border-border rounded px-1 py-0.5 bg-background" :value="c.leftField" :title="c.leftDeId ? label(c.leftDeId) : ''" @change="patchCond(ci, 'leftField', $event.target.value)">
            <option value="" disabled>left field…</option>
            <option v-for="f in fieldsOf(c.leftDeId || editJoin.leftDeId)" :key="f" :value="f">{{ f }}</option>
          </select>
          <select class="w-11 border border-border rounded px-0.5 py-0.5 bg-background" :value="c.operator || '='" @change="patchCond(ci, 'operator', $event.target.value)">
            <option v-for="op in OPERATORS" :key="op">{{ op }}</option>
          </select>
          <select class="flex-1 min-w-0 border border-border rounded px-1 py-0.5 bg-background" :value="c.rightField" @change="patchCond(ci, 'rightField', $event.target.value)">
            <option value="" disabled>right field…</option>
            <option v-for="f in fieldsOf(editJoin.rightDeId)" :key="f" :value="f">{{ f }}</option>
          </select>
          <button class="text-muted-foreground hover:text-destructive" title="Remove this condition" @click="removeCond(ci)"><X class="h-3 w-3" /></button>
        </div>
        <div class="flex items-center gap-3 mt-1">
          <button class="flex items-center gap-1 text-primary hover:underline" @click="addCond"><Plus class="h-3 w-3" /> Add condition</button>
          <button v-if="suggestion.length && !editJoin.conditions.some((c) => c.leftField && c.rightField)" class="flex items-center gap-1 text-primary hover:underline" @click="acceptSuggestion">
            <Wand2 class="h-3 w-3" /> Use {{ suggestion.map((s) => `${s.leftField} = ${s.rightField}`).join(' AND ') }}
          </button>
        </div>
        <p v-if="!editJoin.conditions.some((c) => c.leftField && c.rightField)" class="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          No condition yet: drag from a field on one card to a field on the other, or add one here.
        </p>
      </template>
      <div v-else>
        <textarea class="w-full h-20 border border-border rounded p-1 bg-background font-mono text-[10px]" placeholder="t1.[A] = t2.[A] AND t1.[B] = t2.[B]" :value="editJoin.onClause" @input="patchJoin({ onClause: $event.target.value })" />
        <p class="text-[9px] text-muted-foreground">Use the table aliases and brackets. This replaces the conditions above.</p>
      </div>
      <label class="flex items-center gap-1 mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground cursor-pointer">
        <input type="checkbox" :checked="!!editJoin.rawOn" @change="patchJoin({ rawOn: $event.target.checked })" />
        <Code2 class="h-3 w-3" /> Write the ON expression by hand
      </label>
    </div>
  </div>
</template>

<style>
.qb-canvas .vue-flow__handle.de-handle {
  width: 8px;
  height: 8px;
  min-width: 0;
  min-height: 0;
  border: 1px solid hsl(var(--primary));
  background: hsl(var(--card));
  opacity: 0;
  transition: opacity 0.1s;
}
.qb-canvas .vue-flow__node:hover .vue-flow__handle.de-handle,
.qb-canvas .vue-flow__handle.de-handle.connectionindicator:hover,
.qb-canvas .vue-flow__handle.de-handle.connecting,
.qb-canvas .vue-flow__handle.de-handle.valid { opacity: 1; }
.qb-canvas .vue-flow__handle.de-handle-hdr { opacity: 0 !important; pointer-events: none; }
.qb-canvas .vue-flow__handle.de-handle.valid { background: hsl(var(--primary)); }
.qb-canvas .vue-flow__node-de { padding: 0; border: 0; background: transparent; border-radius: 0.5rem; }
.qb-canvas .vue-flow__node-de.selected .de-node { box-shadow: 0 0 0 2px hsl(var(--primary) / 0.5); }
.qb-canvas .vue-flow__controls { box-shadow: none; border: 1px solid hsl(var(--border)); border-radius: 6px; overflow: hidden; }
.qb-canvas .vue-flow__controls-button { background: hsl(var(--card)); border-bottom: 1px solid hsl(var(--border)); fill: hsl(var(--foreground)); }
.qb-canvas .vue-flow__controls-button:hover { background: hsl(var(--muted)); }
.qb-canvas .vue-flow__controls-button svg { fill: currentColor; color: hsl(var(--foreground)); }
.qb-canvas .vue-flow__minimap { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 6px; }
.qb-canvas .vue-flow__minimap-mask { fill: hsl(var(--muted) / 0.6); }
.qb-canvas .qb-tool {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px;
  border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--card));
  color: hsl(var(--foreground)); font-size: 11px; font-weight: 500;
}
.qb-canvas .qb-tool:hover:not(:disabled) { background: hsl(var(--muted)); }
.qb-canvas .qb-tool:disabled { opacity: 0.5; }
.qb-canvas .qb-tool-on { border-color: hsl(var(--primary) / 0.6); color: hsl(var(--primary)); }
</style>
