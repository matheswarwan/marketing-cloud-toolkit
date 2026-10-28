<script setup>
// A journey drawn like the Journey Builder canvas: horizontal (flow left to right,
// paths stacked) or vertical (flow top to bottom, paths side by side). Nodes are
// positioned by layoutJourney() and journeyGeometry(); edges are SVG elbows with the path labels.
import { computed } from 'vue'
import { LogIn, Mail, Clock, GitBranch, Zap, LogOut } from 'lucide-vue-next'
import { nodeTypeLabel } from '@/utils/journeys.js'
import { journeyGeometry, NODE_W, NODE_H, EXIT_H } from '@/utils/journeySvg.js'

const props = defineProps({
  graph: { type: Object, required: true },
  layout: { type: Object, required: true },
  orientation: { type: String, default: 'horizontal' },
  selected: { type: String, default: null },
})
const emit = defineEmits(['select'])

const geo = computed(() => journeyGeometry(props.graph, props.layout, props.orientation))
const size = computed(() => geo.value.size)
const nodes = computed(() => geo.value.nodes)
const edges = computed(() => geo.value.edges)

const KIND = {
  entry: { icon: LogIn, cls: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40', tag: 'text-emerald-700 dark:text-emerald-300' },
  message: { icon: Mail, cls: 'border-sky-400 bg-sky-50 dark:bg-sky-950/40', tag: 'text-sky-700 dark:text-sky-300' },
  wait: { icon: Clock, cls: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40', tag: 'text-amber-700 dark:text-amber-300' },
  split: { icon: GitBranch, cls: 'border-violet-400 bg-violet-50 dark:bg-violet-950/40', tag: 'text-violet-700 dark:text-violet-300' },
  action: { icon: Zap, cls: 'border-slate-400 bg-slate-50 dark:bg-slate-900', tag: 'text-slate-700 dark:text-slate-300' },
  exit: { icon: LogOut, cls: 'border-dashed border-border bg-muted/40', tag: 'text-muted-foreground' },
}
</script>

<template>
  <div class="relative" :style="{ width: `${size.w}px`, height: `${size.h}px` }">
    <svg class="absolute inset-0 pointer-events-none text-muted-foreground" :width="size.w" :height="size.h" aria-hidden="true">
      <defs>
        <marker id="jarrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
        </marker>
      </defs>
      <g v-for="e in edges" :key="e.id">
        <path :d="e.d" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#jarrow)" />
        <text v-if="e.label" :x="e.lx" :y="e.ly" class="fill-foreground" font-size="10">{{ e.label.length > 28 ? e.label.slice(0, 27) + '…' : e.label }}</text>
      </g>
    </svg>
    <button v-for="n in nodes" :key="n.key" type="button"
      class="absolute text-left rounded-lg border-2 px-2.5 py-1.5 shadow-sm hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="[KIND[n.kind].cls, selected === n.key ? 'ring-2 ring-primary' : '']"
      :style="{ left: `${n.box.x}px`, top: `${n.box.y}px`, width: `${NODE_W}px`, height: `${n.kind === 'exit' ? EXIT_H : NODE_H}px` }"
      :aria-pressed="selected === n.key" :title="n.name" @click="emit('select', n.key)">
      <div class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" :class="KIND[n.kind].tag">
        <component :is="KIND[n.kind].icon" class="h-3 w-3 shrink-0" />
        <span class="truncate">{{ n.kind === 'entry' ? 'Entry' : n.kind === 'exit' ? 'Exit' : nodeTypeLabel(n.type) }}</span>
      </div>
      <div v-if="n.kind !== 'exit'" class="text-xs font-medium truncate text-foreground">{{ n.name }}</div>
      <div v-if="n.summary" class="text-[10px] text-muted-foreground truncate">{{ n.summary }}</div>
    </button>
  </div>
</template>
