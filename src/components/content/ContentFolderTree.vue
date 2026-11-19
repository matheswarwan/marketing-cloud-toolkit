<script setup>
// Folder tree: Content Builder folders for Content > Emails (feedback #1054) and
// CloudPages (#1059), or any folders given by `load` (Automations, Journeys, DEs). Folders load as they are opened. v-model is the open folder ({ id, name }
// or null for "All").
// Items (feedback #1119): the page passes what it listed for the open folder (`items`, for folder `itemsFolder`),
// shown under that folder after its sub-folders; clicking one emits `item`. Long names scroll sideways (#1118).
import { computed, reactive, ref, watch } from 'vue'
import { Loader2, Folder, FolderOpen, ChevronRight, ChevronDown, FileText } from 'lucide-vue-next'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { fetchContentFolders } from '@/utils/contentEmails.js'
import { cached, cacheKey, cacheScope, forgetCache, savedAgo } from '@/utils/localCache.js'
import { RefreshCw } from 'lucide-vue-next'

const props = defineProps({
  stack: { type: String, default: null },
  modelValue: { type: Object, default: null },
  categoryType: { type: String, default: '' },
  allLabel: { type: String, default: 'All' },
  allIcon: { type: [Object, Function], default: null },
  // Any other folder source (feedback #1064, #1065): (parentId) => Promise<[{ id, name }]>,
  // '0' being the top level. Without it, Content Builder folders.
  load: { type: Function, default: null },
  // Stored for 30 days under this name (feedback #1069); the refresh icon reads SFMC again.
  cacheKind: { type: String, default: '' },
  // The open folder's items as the page listed them: [{ id, name }]. Shown only while
  // `itemsFolder` is the open folder's id (so a previous folder's list never shows under a new one).
  items: { type: Array, default: () => [] },
  itemsFolder: { type: [String, Number], default: null },
  itemsTotal: { type: Number, default: null }, // how many the folder has, when more than listed
  itemIcon: { type: [Object, Function], default: null },
  activeItem: { type: [String, Number], default: null },
})
const emit = defineEmits(['update:modelValue', 'item'])
const ITEMS_SHOWN = 200

const children = reactive({})
const expanded = reactive(new Set())
const loading = reactive(new Set())
const error = ref(null)

const kind = computed(() => `folders-${props.cacheKind || (props.load ? 'custom' : `content-${props.categoryType || 'all'}`)}`)
const savedAt = ref(null)
async function loadChildren(parentId, force = false) {
  if (!props.stack || (children[parentId] && !force) || loading.has(parentId)) return
  loading.add(parentId)
  const read = () => withReconnect(props.stack, () => (props.load ? props.load(parentId) : fetchContentFolders(props.stack, parentId, { categoryType: props.categoryType })))
  try {
    if (props.cacheKind || !props.load) {
      const scope = await cacheScope(props.stack)
      const r = await cached(cacheKey(scope, kind.value, parentId), read, { force })
      children[parentId] = r.value
      if (parentId === '0') savedAt.value = r.savedAt
    } else children[parentId] = await read()
  }
  catch (e) { error.value = searchError(e, 'read the folders') }
  finally { loading.delete(parentId) }
}
function toggle(f) {
  if (expanded.has(f.id)) expanded.delete(f.id)
  else { expanded.add(f.id); loadChildren(f.id) }
}
function open(f) {
  emit('update:modelValue', f ? { id: f.id, name: f.name } : null)
  if (f && !expanded.has(f.id)) { expanded.add(f.id); loadChildren(f.id) }
}
const itemsHere = computed(() => props.modelValue != null && props.itemsFolder != null && String(props.itemsFolder) === String(props.modelValue.id))
const visible = computed(() => {
  const out = []
  const seen = new Set() // a folder listed under its own child is shown once
  const walk = (pid, depth) => {
    for (const f of children[pid] || []) {
      if (seen.has(f.id) || depth > 30) continue
      seen.add(f.id)
      out.push({ ...f, depth })
      if (expanded.has(f.id)) {
        if (loading.has(f.id)) out.push({ id: `${f.id}:loading`, loading: true, depth: depth + 1 })
        walk(f.id, depth + 1)
        if (itemsHere.value && props.modelValue?.id === f.id) {
          for (const it of props.items.slice(0, ITEMS_SHOWN)) out.push({ id: `item:${it.id}`, item: it, depth: depth + 1 })
          const total = Math.max(props.itemsTotal ?? 0, props.items.length)
          if (total > Math.min(props.items.length, ITEMS_SHOWN)) out.push({ id: `${f.id}:more`, more: total - Math.min(props.items.length, ITEMS_SHOWN), depth: depth + 1 })
        }
      }
    }
  }
  walk('0', 0)
  return out
})
/** Reads the folders again; `force` asks SFMC instead of the stored copy. */
async function reload(force = false) {
  for (const k of Object.keys(children)) delete children[k]
  expanded.clear()
  error.value = null
  if (force && props.stack) await forgetCache(kind.value, await cacheScope(props.stack))
  loadChildren('0', force)
}
watch(() => props.stack, () => reload(), { immediate: true })
defineExpose({ reload })
</script>

<template>
  <nav class="overflow-auto p-2" aria-label="Folders" data-content-folders>
   <div class="min-w-full w-max">
    <div class="flex items-center gap-1">
      <button type="button" class="flex-1 flex items-center gap-1.5 rounded px-2 py-1 text-left" :class="!modelValue ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent'" @click="open(null)">
        <component :is="allIcon || Folder" class="h-4 w-4" /> {{ allLabel }}
      </button>
      <button type="button" class="p-1 rounded text-muted-foreground hover:bg-accent" :title="savedAt ? `Folders saved ${savedAgo(savedAt)}. Read them again from SFMC` : 'Read the folders again from SFMC'" aria-label="Refresh folders" data-folders-refresh @click="reload(true)"><RefreshCw class="h-3.5 w-3.5" /></button>
    </div>
    <div v-for="f in visible" :key="f.id" :style="{ paddingLeft: `${f.depth * 14}px` }">
      <div v-if="f.loading" class="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Loading</div>
      <div v-else-if="f.more" class="px-2 py-1 pl-7 text-xs text-muted-foreground whitespace-nowrap" data-folder-more>{{ f.more.toLocaleString() }} more in the list</div>
      <button v-else-if="f.item" type="button" class="flex w-full items-center gap-1.5 rounded py-1 pl-7 pr-2 text-left whitespace-nowrap" :class="activeItem != null && String(activeItem) === String(f.item.id) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'" :title="f.item.name" :data-folder-item="f.item.id" @click="emit('item', f.item)">
        <component :is="itemIcon || FileText" class="h-3.5 w-3.5 shrink-0" /><span>{{ f.item.name || 'Untitled' }}</span>
      </button>
      <div v-else class="flex items-center rounded" :class="modelValue?.id === f.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent'">
        <button type="button" class="p-1" :aria-label="expanded.has(f.id) ? `Close ${f.name}` : `Open ${f.name}`" @click="toggle(f)">
          <ChevronDown v-if="expanded.has(f.id)" class="h-3.5 w-3.5" /><ChevronRight v-else class="h-3.5 w-3.5" />
        </button>
        <button type="button" class="flex-1 flex items-center gap-1.5 py-1 pr-2 text-left whitespace-nowrap" :title="f.name" :data-folder="f.id" @click="open(f)">
          <FolderOpen v-if="modelValue?.id === f.id" class="h-4 w-4 shrink-0" /><Folder v-else class="h-4 w-4 shrink-0" />
          <span>{{ f.name }}</span>
        </button>
      </div>
    </div>
    <div v-if="loading.has('0')" class="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Loading folders</div>
   </div>
    <SfmcErrorNotice v-if="error" :error="error" class="mt-2" @retry="reload" />
  </nav>
</template>
