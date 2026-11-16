<script setup>
// One box on the Where used map: a type chip, the name and a subtitle. Data extensions
// are pills, activities square-cornered, everything else rounded; the checked data
// extension has the primary ring, possible matches a dashed border.
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  Database, Table2, FileCode, Filter, ArrowDownToLine, ArrowUpFromLine, FileText, Braces, Send, Zap, Route as RouteIcon, LayoutTemplate, Ellipsis,
  Columns3, ArrowRightLeft, FolderOpen, Workflow, ListOrdered, UserCog,
} from 'lucide-vue-next'
import { NODE_TYPES } from '@/utils/usage/graph.js'

const props = defineProps({ data: { type: Object, required: true } })
defineOptions({ inheritAttrs: false })
const emit = defineEmits(['select', 'open', 'hover'])

const ICONS = {
  de: Database, dataview: Table2, query: FileCode, filter: Filter, import: ArrowDownToLine, extract: ArrowUpFromLine, file: FileText,
  script: Braces, send: Send, event: Zap, journey: RouteIcon, content: LayoutTemplate, more: Ellipsis,
  field: Columns3, transfer: ArrowRightLeft, location: FolderOpen, automation: Workflow, step: ListOrdered, profile: UserCog,
}
const icon = computed(() => ICONS[props.data.type] || FileText)
const typeLabel = computed(() => NODE_TYPES[props.data.type]?.label || '')
const label = computed(() => {
  const d = props.data
  const parts = [d.focus ? `${typeLabel.value}, the one checked` : typeLabel.value, d.label, d.sub && !d.focus ? d.sub : '', d.ghost || '', d.possible ? 'possible match' : '']
  return parts.filter(Boolean).join('. ')
})
</script>

<template>
  <div class="umap-node" :data-type="data.type" :data-node-id="data.id" :data-state="data.state || undefined"
    :class="{ 'is-focus': data.focus, 'is-possible': data.possible, 'is-ghost': !!data.ghost, 'is-selected': data.selected, 'is-dim': data.dim, 'is-more': data.type === 'more' }"
    @mouseenter="emit('hover', data.id)" @mouseleave="emit('hover', null)">
    <Handle type="target" :position="Position.Left" :connectable="false" class="umap-handle" />
    <button type="button" class="umap-node-button" :data-map-node="data.id" :aria-label="label" :aria-pressed="data.type === 'more' ? undefined : !!data.selected"
      :title="data.type === 'more' ? 'Show them all' : data.ghost ? data.ghost : (data.deName || data.type === 'automation') && !data.focus ? 'Click for details, double-click to check it in turn' : ''"
      @click="emit('select', data.id)" @dblclick="emit('open', data.id)" @focus="emit('hover', data.id)" @blur="emit('hover', null)">
      <span class="umap-chip" aria-hidden="true"><component :is="icon" class="h-3.5 w-3.5" /></span>
      <span class="umap-text">
        <span class="umap-name">{{ data.label }}</span>
        <span class="umap-sub">{{ data.sub }}</span>
      </span>
    </button>
    <Handle type="source" :position="Position.Right" :connectable="false" class="umap-handle" />
  </div>
</template>
