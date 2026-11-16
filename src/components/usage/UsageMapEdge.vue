<script setup>
// One line on the Where used map. The path and arrowhead come from graphLayout.js (so
// the picture download draws the same); the arrowhead is a path here so it takes the
// line's colour from CSS in both themes. The label shows while the line is lit.
import { BaseEdge, EdgeLabelRenderer } from '@vue-flow/core'

defineProps({ id: { type: String, required: true }, data: { type: Object, required: true } })
defineOptions({ inheritAttrs: false })
</script>

<template>
  <g class="umap-edge" :data-rel="data.rel" :data-state="data.state || undefined" :class="{ 'is-possible': data.possible, 'is-lit': data.lit, 'is-dim': data.dim, 'is-back': data.back }">
    <BaseEdge :id="id" :path="data.path" class="umap-line" :interaction-width="0" />
    <path v-if="data.arrow" :d="data.arrow" class="umap-arrow" />
  </g>
  <EdgeLabelRenderer>
    <span v-if="data.lit && data.label" class="umap-edge-label" :data-rel="data.rel"
      :style="{ transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)` }">{{ data.label }}</span>
  </EdgeLabelRenderer>
</template>
