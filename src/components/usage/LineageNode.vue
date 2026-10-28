<script setup>
// One level of a lineage tree: each child is a data extension (or a file) reached
// through a query, filter, import or extract. Recursive.
import { FileText, Database } from 'lucide-vue-next'

defineOptions({ name: 'LineageNode' })
const props = defineProps({
  node: { type: Object, required: true },
  direction: { type: String, required: true }, // up | down
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['pivot'])
const VIA = { query: 'query', filter: 'filter', import: 'import', extract: 'data extract' }
</script>

<template>
  <ul class="space-y-1" :class="depth ? 'ml-4 pl-3 border-l border-border' : ''">
    <li v-for="(c, i) in props.node.children" :key="i">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground">{{ direction === 'up' ? 'from' : 'to' }} {{ VIA[c.via.kind] }} <span class="text-foreground">{{ c.via.name }}</span></span>
        <span class="text-muted-foreground">{{ direction === 'up' ? '←' : '→' }}</span>
        <template v-if="c.name">
          <Database class="h-3 w-3 text-muted-foreground" />
          <button class="font-medium text-primary hover:underline" :title="`Where is ${c.name} used?`" @click="emit('pivot', c.name)">{{ c.name }}</button>
          <span v-if="c.cycle" class="text-[10px] text-amber-700 dark:text-amber-400">(already above: a loop)</span>
          <span v-else-if="c.truncated" class="text-[10px] text-muted-foreground">(more beyond this level)</span>
        </template>
        <template v-else>
          <FileText class="h-3 w-3 text-muted-foreground" />
          <span>{{ c.via.file ? `file ${c.via.file}` : 'a file' }}</span>
        </template>
      </div>
      <LineageNode v-if="c.children?.length" :node="c" :direction="direction" :depth="depth + 1" @pivot="emit('pivot', $event)" />
    </li>
  </ul>
</template>
