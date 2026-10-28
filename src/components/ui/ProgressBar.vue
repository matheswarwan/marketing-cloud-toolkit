<script setup>
// One progress bar for the whole app (feedback #123). With a `max` it fills to
// value/max; without one (or `indeterminate`) it shows moving stripes, like Automation
// Studio's running bar. The stripes stand still for people who prefer reduced motion.
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 0 },
  indeterminate: { type: Boolean, default: false },
  striped: { type: Boolean, default: false }, // moving stripes on a known fill too
  label: { type: String, default: '' }, // text next to the bar
  ariaLabel: { type: String, default: '' },
  showCount: { type: Boolean, default: false }, // "12 of 40" after the label
  tone: { type: String, default: 'primary' }, // primary | warning | success
  size: { type: String, default: 'sm' }, // xs | sm | md
  barClass: { type: String, default: '' },
})

const unknown = computed(() => props.indeterminate || !(props.max > 0))
const percent = computed(() => (unknown.value ? 100 : Math.max(0, Math.min(100, (100 * props.value) / props.max))))
const height = computed(() => ({ xs: 'h-1', sm: 'h-1.5', md: 'h-2.5' }[props.size] || 'h-1.5'))
const fill = computed(() => ({ warning: 'bg-amber-500', success: 'bg-emerald-500' }[props.tone] || 'bg-primary'))
const count = computed(() => (props.showCount && !unknown.value ? `${props.value.toLocaleString()} of ${props.max.toLocaleString()}` : ''))
</script>

<template>
  <div class="flex items-center gap-2 min-w-0">
    <span v-if="label || count" class="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{{ label }}<template v-if="label && count"> </template>{{ count }}</span>
    <div class="flex-1 min-w-12 rounded-full bg-muted overflow-hidden" :class="[height, barClass]" role="progressbar"
      :aria-label="ariaLabel || label || 'Progress'" aria-valuemin="0" :aria-valuemax="unknown ? undefined : max" :aria-valuenow="unknown ? undefined : value"
      :aria-busy="unknown ? 'true' : undefined">
      <div class="h-full rounded-full transition-[width] duration-300" :class="[fill, unknown || striped ? 'tk-stripes' : '']" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>
