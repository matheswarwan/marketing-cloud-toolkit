<script setup>
// A link on the data model map: a curve with the cardinality drawn at each end (a bar
// for one, a crow's foot for many, as in entity diagrams) and, while lit, the fields it
// joins on.
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'

const props = defineProps({
  id: { type: String, required: true }, data: { type: Object, required: true },
  sourceX: Number, sourceY: Number, targetX: Number, targetY: Number, sourcePosition: String, targetPosition: String,
})
defineOptions({ inheritAttrs: false })

const geo = computed(() => {
  const [path, labelX, labelY] = getBezierPath({ sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY, sourcePosition: props.sourcePosition, targetPosition: props.targetPosition })
  return { path, labelX, labelY }
})
// The mark at one end: x is the card's edge, dir points away from the card (+1 or -1).
function mark(end, x, y, dir) {
  if (end === 'many') return `M${x + dir * 12},${y} L${x},${y - 6} M${x + dir * 12},${y} L${x},${y} M${x + dir * 12},${y} L${x},${y + 6}`
  return `M${x + dir * 8},${y - 6} L${x + dir * 8},${y + 6}`
}
const ends = computed(() => `${mark(props.data.sourceEnd, props.sourceX, props.sourceY, 1)} ${mark(props.data.targetEnd, props.targetX, props.targetY, -1)}`)
const words = computed(() => `${props.data.sourceEnd === 'many' ? 'many' : 'one'}-to-${props.data.targetEnd === 'many' ? 'many' : 'one'}`)
</script>

<template>
  <g class="dm-edge" :class="{ 'is-lit': data.lit, 'is-dim': data.dim }" :data-dm-edge="id">
    <BaseEdge :id="id" :path="geo.path" class="dm-line" :interaction-width="0" />
    <path :d="ends" class="dm-ends" />
  </g>
  <EdgeLabelRenderer>
    <span v-if="data.lit" class="dm-edge-label" :style="{ transform: `translate(-50%, -50%) translate(${geo.labelX}px, ${geo.labelY}px)` }">
      {{ words }}<template v-if="data.fields"><br><span class="dm-edge-fields">{{ data.fields }}</span></template>
    </span>
  </EdgeLabelRenderer>
</template>
