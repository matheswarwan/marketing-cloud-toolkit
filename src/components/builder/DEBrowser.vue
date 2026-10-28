<script setup>
import { ref, onMounted, watch } from 'vue'
import { ChevronRight, ChevronDown, Database, Search, Loader2, Folder } from 'lucide-vue-next'
import Input from '../ui/input/Input.vue'
import {
  loadRootSections, loadFolderContents, getDataViewNodes, debouncedSearchDEs,
} from '../../utils/deCatalog.js'
import DETreeNode from './DETreeNode.vue'
import SfmcErrorNotice from '../results/SfmcErrorNotice.vue'
import { withReconnect, searchError as describeError } from '../../utils/sfmcErrors.js'

const props = defineProps({
  stack: { type: String, default: null },
})

const emit = defineEmits(['select-de'])

const roots = ref([])
const dataViews = ref(getDataViewNodes())
const expanded = ref(new Set())
const loadingFolders = ref(new Set())
const folderChildren = ref({}) // folderId -> nodes[]
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)
const searchError = ref('')
const showDataViews = ref(true)
const rootsError = ref(null)
const loadingRoots = ref(false)

// Failing to read the folders used to leave the tree empty (feedback #93).
async function loadRoots() {
  if (!props.stack) return
  loadingRoots.value = true
  rootsError.value = null
  try {
    roots.value = await withReconnect(props.stack, () => loadRootSections(props.stack))
  } catch (e) {
    roots.value = []
    rootsError.value = describeError(e, 'read the data extension folders')
  } finally {
    loadingRoots.value = false
  }
}

watch(() => props.stack, loadRoots, { immediate: true })

function toggleExpand(node) {
  const key = String(node.id)
  if (expanded.value.has(key)) {
    expanded.value.delete(key)
    expanded.value = new Set(expanded.value)
    return
  }
  expanded.value.add(key)
  expanded.value = new Set(expanded.value)
  if (node.type === 'folder' && !folderChildren.value[key]) {
    loadChildren(node)
  }
}

async function loadChildren(node) {
  const key = String(node.id)
  loadingFolders.value.add(key)
  loadingFolders.value = new Set(loadingFolders.value)
  try {
    folderChildren.value[key] = await loadFolderContents(props.stack, node)
    folderChildren.value = { ...folderChildren.value }
  } finally {
    loadingFolders.value.delete(key)
    loadingFolders.value = new Set(loadingFolders.value)
  }
}

function onSearchInput() {
  if (!props.stack || !searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  searching.value = true
  // Data views are not data extensions, so SFMC's DE search never returns them
  // (feedback #137: _ChatMessagingSubscription); match them by name here.
  const dvMatches = () => {
    const q = searchQuery.value.trim().toLowerCase()
    return q ? dataViews.value.filter((n) => n.name.toLowerCase().includes(q)) : []
  }
  searchResults.value = dvMatches()
  debouncedSearchDEs(props.stack, searchQuery.value, (items, error) => {
    // DEs already shown in opened folders count too (feedback #89: a DE in the tree
    // the search did not return).
    const q = searchQuery.value.trim().toLowerCase()
    const ids = new Set(items.map((d) => String(d.id)))
    const inTree = Object.values(folderChildren.value).flat()
      .filter((n) => n?.type === 'de' && String(n.name || '').toLowerCase().includes(q) && !ids.has(String(n.id)))
    searchResults.value = [...dvMatches(), ...items, ...inTree]
    searchError.value = searchResults.value.length ? '' : (error || '')
    searching.value = false
  })
}

function selectDe(node) {
  emit('select-de', node)
}

function onDeDragStart(e, node) {
  try {
    e.dataTransfer.setData('application/x-sfmc-de', JSON.stringify(node))
    e.dataTransfer.effectAllowed = 'copy'
  } catch { /* ignore */ }
}

function badgeClass(sourceType) {
  const map = {
    folder: 'bg-blue-100 text-blue-700',
    shared: 'bg-purple-100 text-purple-700',
    sync: 'bg-teal-100 text-teal-700',
    salesforce: 'bg-orange-100 text-orange-700',
    dataview: 'bg-slate-200 text-slate-700',
    search: 'bg-amber-100 text-amber-700',
  }
  return map[sourceType] || 'bg-muted text-muted-foreground'
}

</script>

<template>
  <div class="de-browser flex flex-col h-full border-r border-border bg-card">
    <div class="p-2 border-b border-border shrink-0">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input v-model="searchQuery" class="pl-8 h-8 text-xs" placeholder="Search all DEs and data views…" @input="onSearchInput" />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-1 text-xs">
      <div v-if="searchQuery.trim()">
        <div v-if="searching" class="flex items-center gap-1 p-2 text-muted-foreground">
          <Loader2 class="h-3 w-3 animate-spin" /> Searching…
        </div>
        <button
          v-for="node in searchResults"
          :key="node.id"
          class="w-full text-left px-2 py-1.5 rounded hover:bg-muted flex items-center gap-1.5 cursor-grab active:cursor-grabbing"
          draggable="true"
          @dragstart="onDeDragStart($event, node)"
          @click="selectDe(node)"
        >
          <Database class="h-3 w-3 shrink-0" />
          <span class="truncate flex-1">{{ node.name }}</span>
          <span class="text-[9px] px-1 rounded" :class="badgeClass(node.sourceType)">{{ node.sourceType === 'dataview' ? 'Data view' : node.sourceType }}</span>
        </button>
        <div v-if="!searching && !searchResults.length && searchError" class="p-2 text-red-600" role="alert">Search failed: {{ searchError }}</div>
        <div v-else-if="!searching && !searchResults.length" class="p-2 text-muted-foreground italic">No matches</div>
      </div>

      <template v-else>
        <!-- Root folders -->
        <div class="mt-1 text-xs"><SfmcErrorNotice v-if="rootsError" :error="rootsError" :retrying="loadingRoots" @retry="loadRoots" /></div>
        <div v-for="root in roots" :key="root.id" class="mt-1">
          <button class="w-full flex items-center gap-1 px-1 py-1 hover:bg-muted rounded" @click="toggleExpand(root)">
            <ChevronDown v-if="expanded.has(String(root.id))" class="h-3 w-3" />
            <ChevronRight v-else class="h-3 w-3" />
            <Folder class="h-3 w-3 text-muted-foreground" />
            <span class="font-medium truncate">{{ root.name }}</span>
            <span class="text-[9px] px-1 rounded ml-auto" :class="badgeClass(root.sourceType)">{{ root.sourceType }}</span>
          </button>

          <div v-if="expanded.has(String(root.id))">
            <div v-if="loadingFolders.has(String(root.id))" class="p-1 text-muted-foreground flex gap-1">
              <Loader2 class="h-3 w-3 animate-spin" /> Loading…
            </div>
            <DETreeNode
              v-for="child in folderChildren[String(root.id)] || []"
              :key="child.id"
              :node="child"
              :depth="1"
              :expanded="expanded"
              :loading-folders="loadingFolders"
              :folder-children="folderChildren"
              @toggle="toggleExpand"
              @select="selectDe"
            />
          </div>
        </div>

        <div v-if="!roots.length && stack" class="p-2 text-muted-foreground">Loading folders…</div>
        <div v-if="!stack" class="p-2 text-muted-foreground">Connect to SFMC first</div>

        <!-- System Data Views (moved to bottom) -->
        <button class="w-full flex items-center gap-1 px-1 py-1 mt-2 border-t border-border font-semibold text-[10px] uppercase text-muted-foreground" @click="showDataViews = !showDataViews">
          <ChevronDown v-if="showDataViews" class="h-3 w-3" /><ChevronRight v-else class="h-3 w-3" />
          System Data Views
        </button>
        <template v-if="showDataViews">
          <button
            v-for="dv in dataViews"
            :key="dv.id"
            class="w-full text-left pl-4 pr-2 py-1 rounded hover:bg-muted flex items-center gap-1 cursor-grab active:cursor-grabbing"
            draggable="true"
            @dragstart="onDeDragStart($event, dv)"
            @click="selectDe(dv)"
          >
            <Database class="h-3 w-3" />
            <span class="truncate">{{ dv.name }}</span>
          </button>
        </template>
      </template>
    </div>
  </div>
</template>
