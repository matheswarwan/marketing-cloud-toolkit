<script setup>
// Data extension folder tree (under the local "Data Extensions" folder), read one
// level at a time. Shared by Save as query activity (#88) and Create DE (#94).
// v-model is the folder id; `path` (v-model:path) is its "Data Extensions > ..." name.
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown, Folder, Loader2 } from 'lucide-vue-next'
import { loadDERoot, loadDEChildFolders } from '../../utils/saveAsActivity.js'

const props = defineProps({
  stack: { type: String, default: null },
  modelValue: { type: [String, Number], default: null },
  path: { type: String, default: '' },
  height: { type: String, default: 'max-h-40' },
})
const emit = defineEmits(['update:modelValue', 'update:path', 'error'])

const root = ref(null)
const children = ref({}) // id -> folders
const open = ref(new Set())
const names = ref({}) // id -> path
const loading = ref(false)

async function load() {
  root.value = null
  children.value = {}
  open.value = new Set()
  names.value = {}
  if (!props.stack) return
  loading.value = true
  try {
    const r = await loadDERoot(props.stack)
    root.value = r
    if (r) {
      names.value = { [r.id]: r.name }
      await toggle(r)
    }
  } catch (e) {
    emit('error', `Could not read the folders: ${e.message}`)
  } finally {
    loading.value = false
  }
}

async function toggle(folder) {
  const id = String(folder.id)
  const next = new Set(open.value)
  if (next.has(id)) { next.delete(id); open.value = next; return }
  next.add(id)
  open.value = next
  if (children.value[id]) return
  try {
    const kids = await loadDEChildFolders(props.stack, folder.id)
    children.value = { ...children.value, [id]: kids }
    const n = { ...names.value }
    for (const k of kids) n[k.id] = `${n[folder.id] || folder.name} > ${k.name}`
    names.value = n
  } catch (e) {
    emit('error', `Could not read the folder: ${e.message}`)
  }
}

function pick(f) {
  emit('update:modelValue', f.id)
  emit('update:path', names.value[f.id] || f.name)
}

const rows = computed(() => {
  const out = []
  const walk = (f, depth) => {
    out.push({ ...f, depth })
    if (open.value.has(String(f.id))) for (const c of children.value[String(f.id)] || []) walk(c, depth + 1)
  }
  if (root.value) walk(root.value, 0)
  return out
})

const shownPath = computed(() => names.value[props.modelValue] || props.path || '')

watch(() => props.stack, load, { immediate: true })
</script>

<template>
  <div class="space-y-1">
    <span class="text-muted-foreground">Folder: <b class="text-foreground">{{ shownPath || 'none picked' }}</b></span>
    <div class="overflow-y-auto border border-border rounded p-1" :class="height" role="tree" aria-label="Data extension folders">
      <div v-if="loading" class="flex items-center gap-1 p-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Reading folders...</div>
      <div v-for="f in rows" :key="f.id" class="flex items-center gap-1 rounded px-1 py-0.5" :class="String(modelValue) === String(f.id) ? 'bg-primary/10' : 'hover:bg-muted'" :style="{ paddingLeft: `${4 + f.depth * 14}px` }" role="treeitem" :aria-selected="String(modelValue) === String(f.id)">
        <button type="button" class="h-4 w-4 flex items-center justify-center" :aria-label="open.has(String(f.id)) ? 'Collapse' : 'Expand'" @click="toggle(f)">
          <ChevronDown v-if="open.has(String(f.id))" class="h-3 w-3" /><ChevronRight v-else class="h-3 w-3" />
        </button>
        <button type="button" class="flex items-center gap-1 flex-1 text-left" @click="pick(f)"><Folder class="h-3 w-3" /> {{ f.name }}</button>
      </div>
    </div>
  </div>
</template>
