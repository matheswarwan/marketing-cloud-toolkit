<script setup>
import { ChevronRight, ChevronDown, FileCode, Folder } from 'lucide-vue-next'

const props = defineProps({
  node:     { type: Object, required: true }, // { id, name, activities: [], children: [] }
  depth:    { type: Number, default: 0 },
  expanded: { type: Object, required: true }, // Set<string>
  relativeDate: { type: Function, required: true },
})

const emit = defineEmits(['toggle', 'select'])

function key(n) {
  return String(n.id)
}
</script>

<template>
  <div>
    <button
      class="w-full flex items-center gap-1.5 py-1.5 pr-2 hover:bg-muted rounded text-left"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="emit('toggle', node)"
    >
      <ChevronDown v-if="expanded.has(key(node))" class="h-3 w-3 shrink-0 text-muted-foreground" />
      <ChevronRight v-else class="h-3 w-3 shrink-0 text-muted-foreground" />
      <Folder class="h-3.5 w-3.5 shrink-0 text-primary" />
      <span class="text-sm font-medium text-foreground truncate flex-1">{{ node.name }}</span>
      <span class="text-[10px] text-muted-foreground shrink-0">{{ node.activities.length + node.children.length }}</span>
    </button>

    <div v-if="expanded.has(key(node))">
      <QueryActivityTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expanded="expanded"
        :relative-date="relativeDate"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
      />

      <button
        v-for="item in node.activities"
        :key="item.queryDefinitionId"
        class="w-full flex items-center justify-between gap-3 py-1.5 pr-2 rounded hover:bg-primary/5 hover:text-primary text-left"
        :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }"
        @click="emit('select', item)"
      >
        <span class="flex items-center gap-1.5 min-w-0 flex-1">
          <FileCode class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span class="text-sm text-foreground truncate">{{ item.name }}</span>
        </span>
        <span class="text-[10px] text-muted-foreground shrink-0">{{ relativeDate(item.modifiedDate) }}</span>
      </button>

      <div
        v-if="!node.activities.length && !node.children.length"
        class="text-xs text-muted-foreground italic py-1"
        :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }"
      >
        Empty
      </div>
    </div>
  </div>
</template>
