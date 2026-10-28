<script setup>
import { ref, computed, watch } from 'vue'
import QueryPanel from './QueryPanel.vue'

const props = defineProps({
  panels:          { type: Array, required: true },
  stack:           { type: String, default: null },
  canInteract:     { type: Boolean, default: false },
  layoutRows:      { type: Number, default: 1 },
  layoutCols:      { type: Number, default: 1 },
})

const emit = defineEmits(['remove-panel', 'duplicate-panel'])

// Minimum size (percent) any single row/column track may shrink to.
const MIN = 20
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const even = (n) => Array.from({ length: n }, () => 100 / n)

// Track sizes as percentages that sum to 100. Rendered as fr units so the grid
// gap is handled automatically. Reset to equal whenever the layout changes.
const colSizes = ref(even(props.layoutCols))
const rowSizes = ref(even(props.layoutRows))
watch(() => props.layoutCols, (n) => { colSizes.value = even(n); expandedId.value = null })
watch(() => props.layoutRows, (n) => { rowSizes.value = even(n); expandedId.value = null })

// Expand-in-place: the expanded panel fills the grid, the rest are hidden
// (never unmounted — an in-progress run in another panel must keep polling).
const expandedId = ref(null)
function toggleExpand(queryId) {
  expandedId.value = expandedId.value === queryId ? null : queryId
}
watch(() => props.panels, (list) => {
  if (expandedId.value && !list.some(p => p.queryId === expandedId.value)) expandedId.value = null
})

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: colSizes.value.map((s) => `${s}fr`).join(' '),
  gridTemplateRows: rowSizes.value.map((s) => `${s}fr`).join(' '),
  gap: '6px',
  height: '100%',
  minHeight: 0,
}))

// Cumulative boundary positions (percent) between adjacent tracks — one per gap.
const boundaries = (sizes) => {
  const out = []
  let acc = 0
  for (let i = 0; i < sizes.length - 1; i++) { acc += sizes[i]; out.push(acc) }
  return out
}
const colBoundaries = computed(() => boundaries(colSizes.value))
const rowBoundaries = computed(() => boundaries(rowSizes.value))

const gridRef = ref(null)
let drag = null

function startDrag(axis, i, e) {
  e.preventDefault()
  if (!gridRef.value) return
  const sizes = axis === 'col' ? colSizes.value : rowSizes.value
  drag = {
    axis,
    i,
    rect: gridRef.value.getBoundingClientRect(),
    start: axis === 'col' ? e.clientX : e.clientY,
    a: sizes[i],
    b: sizes[i + 1],
  }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
  document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
}

function onDrag(e) {
  if (!drag) return
  const { axis, i, rect, start, a, b } = drag
  const total = a + b
  const deltaPct = axis === 'col'
    ? ((e.clientX - start) / rect.width) * 100
    : ((e.clientY - start) / rect.height) * 100
  const newA = clamp(a + deltaPct, MIN, total - MIN)
  const next = [...(axis === 'col' ? colSizes.value : rowSizes.value)]
  next[i] = newA
  next[i + 1] = total - newA
  if (axis === 'col') colSizes.value = next
  else rowSizes.value = next
}

function endDrag() {
  drag = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
</script>

<template>
  <div class="workspace-grid flex-1 min-h-0 p-1.5 bg-muted/30">
    <div ref="gridRef" class="relative w-full h-full" :style="gridStyle">
      <QueryPanel
        v-for="(panel, idx) in panels"
        :key="panel.queryId"
        :query-id="panel.queryId"
        :stack="stack"
        :can-interact="canInteract"
        :initial-sql="panel.initialSql || ''"
        :panel-index="idx"
        :show-close="panels.length > 1"
        :is-expanded="expandedId === panel.queryId"
        :class="expandedId && expandedId !== panel.queryId ? 'hidden' : ''"
        :style="expandedId === panel.queryId ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : {}"
        @close="emit('remove-panel', idx)"
        @duplicate="emit('duplicate-panel', idx)"
        @expand="toggleExpand(panel.queryId)"
      />

      <template v-if="!expandedId">
        <!-- Column resize handles (drag to change panel widths) -->
        <div
          v-for="(b, i) in colBoundaries"
          :key="`col-${i}`"
          class="group absolute top-0 bottom-0 z-20 flex justify-center cursor-col-resize"
          :style="{ left: `${b}%`, width: '12px', transform: 'translateX(-50%)' }"
          title="Drag to resize"
          @mousedown="startDrag('col', i, $event)"
        >
          <div class="h-full w-0.5 rounded bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        </div>

        <!-- Row resize handles (drag to change panel heights) -->
        <div
          v-for="(b, i) in rowBoundaries"
          :key="`row-${i}`"
          class="group absolute left-0 right-0 z-20 flex items-center cursor-row-resize"
          :style="{ top: `${b}%`, height: '12px', transform: 'translateY(-50%)' }"
          title="Drag to resize"
          @mousedown="startDrag('row', i, $event)"
        >
          <div class="w-full h-0.5 rounded bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        </div>
      </template>
    </div>
  </div>
</template>
