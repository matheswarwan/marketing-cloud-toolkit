<script setup>
// A join condition on the canvas: a line from a field of the earlier table to a field
// of the joined table. The first line of each join carries the join type pill; click
// it to edit the join.
import { computed, inject } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@vue-flow/core'
import { joinLabel } from '@/utils/builderCanvas.js'

const props = defineProps({
  id: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false },
})

const canvas = inject('builderCanvas')

const path = computed(() => getSmoothStepPath({
  sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
  targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
  borderRadius: 8, offset: 18,
}))

const active = computed(() => props.selected || canvas.openJoinId.value === props.data.rightDeId)
const style = computed(() => ({
  stroke: props.data.missing ? 'hsl(38 92% 50%)' : 'hsl(var(--primary))',
  strokeWidth: active.value ? 3 : 2,
  strokeDasharray: props.data.missing ? '6 4' : undefined,
}))
const text = computed(() => {
  if (props.data.missing) return `${joinLabel(props.data.joinType)} · set fields`
  if (props.data.raw) return `${joinLabel(props.data.joinType)} · custom ON`
  return joinLabel(props.data.joinType)
})
// Where the outer side of the join is kept: Left keeps the earlier table, Right the joined one.
const keeps = computed(() => ({ 'LEFT JOIN': 'left', 'RIGHT JOIN': 'right', 'FULL OUTER JOIN': 'both' }[props.data.joinType] || ''))
</script>

<template>
  <BaseEdge :id="id" :path="path[0]" :style="style" :interaction-width="16" />
  <EdgeLabelRenderer>
    <div
      v-if="data.operator && data.operator !== '='"
      class="join-op absolute text-[9px] font-mono px-1 rounded bg-card border border-border pointer-events-none"
      :style="{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2 + 14}px)` }"
    >{{ data.operator }}</div>
    <button
      v-if="data.label"
      class="nodrag nopan absolute pointer-events-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm"
      :class="data.missing ? 'bg-amber-50 text-amber-800 border-amber-400 dark:bg-amber-950 dark:text-amber-200' : 'bg-card text-primary border-primary/60 hover:bg-primary/10'"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
      :title="'Edit this join' + (keeps ? ` (keeps every row of the ${keeps === 'both' ? 'two tables' : keeps + ' table'})` : '')"
      @click.stop="canvas.openJoin(data.rightDeId, $event)"
    >
      <span v-if="keeps === 'left' || keeps === 'both'" class="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {{ text }}
      <span v-if="keeps === 'right' || keeps === 'both'" class="inline-block h-1.5 w-1.5 rounded-full bg-current" />
    </button>
  </EdgeLabelRenderer>
</template>
