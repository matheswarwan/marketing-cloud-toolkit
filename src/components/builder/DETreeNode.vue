<script setup>
import { ChevronRight, ChevronDown, Database, Folder, Loader2 } from 'lucide-vue-next'

defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  expanded: { type: Object, required: true },      // Set<string>
  loadingFolders: { type: Object, required: true }, // Set<string>
  folderChildren: { type: Object, required: true }, // { [id]: node[] }
})

const emit = defineEmits(['toggle', 'select'])

function key(n) {
  return String(n.id)
}

function onDeDragStart(e, n) {
  try {
    e.dataTransfer.setData('application/x-sfmc-de', JSON.stringify(n))
    e.dataTransfer.effectAllowed = 'copy'
  } catch { /* ignore */ }
}
</script>

<template>
  <div>
    <!-- Leaf: data extension / data view -->
    <button
      v-if="node.type === 'de'"
      class="w-full text-left py-1 rounded hover:bg-muted flex items-center gap-1 cursor-grab active:cursor-grabbing"
      :style="{ paddingLeft: depth * 12 + 8 + 'px' }"
      draggable="true"
      @dragstart="onDeDragStart($event, node)"
      @click="emit('select', node)"
    >
      <Database class="h-3 w-3 shrink-0" />
      <span class="truncate">{{ node.name }}</span>
    </button>

    <!-- Folder -->
    <template v-else>
      <button
        class="w-full flex items-center gap-1 py-1 hover:bg-muted rounded"
        :style="{ paddingLeft: depth * 12 + 4 + 'px' }"
        @click="emit('toggle', node)"
      >
        <ChevronDown v-if="expanded.has(key(node))" class="h-3 w-3 shrink-0" />
        <ChevronRight v-else class="h-3 w-3 shrink-0" />
        <Folder class="h-3 w-3 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ node.name }}</span>
      </button>

      <div v-if="expanded.has(key(node))">
        <div
          v-if="loadingFolders.has(key(node))"
          class="flex items-center gap-1 text-muted-foreground py-1"
          :style="{ paddingLeft: (depth + 1) * 12 + 8 + 'px' }"
        >
          <Loader2 class="h-3 w-3 animate-spin" /> Loading…
        </div>
        <template v-else>
          <DETreeNode
            v-for="child in folderChildren[key(node)] || []"
            :key="child.id"
            :node="child"
            :depth="depth + 1"
            :expanded="expanded"
            :loading-folders="loadingFolders"
            :folder-children="folderChildren"
            @toggle="emit('toggle', $event)"
            @select="emit('select', $event)"
          />
          <div
            v-if="!(folderChildren[key(node)] || []).length"
            class="text-muted-foreground italic py-1"
            :style="{ paddingLeft: (depth + 1) * 12 + 8 + 'px' }"
          >
            Empty
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
