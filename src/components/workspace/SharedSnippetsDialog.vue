<script setup>
// Shared snippets: SQL the team keeps in the Toolkit_Shared_Snippets data extension of
// this business unit. Insert one at the cursor, share the selection (or the whole
// query), and delete your own.
import { computed, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import { Loader2, X, Plus, Trash2, RefreshCw } from 'lucide-vue-next'
import Button from '../ui/button/Button.vue'
import Input from '../ui/input/Input.vue'
import { findSnippetDE, createSnippetDE, listSnippets, addSnippet, deleteSnippet, SNIPPET_DE } from '../../utils/sharedSnippets.js'
import { loadFeedbackContact } from '../../utils/feedbackContact.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  stack: { type: String, default: null },
  // The selected SQL, else the whole query: what "Share" offers.
  currentSql: { type: String, default: '' },
})
const emit = defineEmits(['close', 'insert'])

const AUTHOR_KEY = 'toolkit_snippetAuthor'
const de = ref(null)
const missing = ref(false)
const snippets = ref([])
const loading = ref(false)
const error = ref('')
const filter = ref('')
const adding = ref(false)
const newName = ref('')
const author = ref('')
const busy = ref(false)

async function load() {
  error.value = ''
  loading.value = true
  try {
    de.value = await findSnippetDE(props.stack)
    missing.value = !de.value
    snippets.value = de.value ? await listSnippets(props.stack, de.value) : []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.open, async (o) => {
  if (!o) return
  adding.value = false
  newName.value = ''
  try {
    const r = await chrome.storage.local.get(AUTHOR_KEY)
    author.value = r?.[AUTHOR_KEY] || (await loadFeedbackContact()).name || ''
  } catch { /* not in the extension */ }
  if (props.stack) load()
}, { immediate: true })

async function create() {
  busy.value = true
  error.value = ''
  try {
    de.value = await createSnippetDE(props.stack)
    missing.value = false
    snippets.value = []
  } catch (e) {
    error.value = `Could not create the data extension: ${e.message}`
  } finally {
    busy.value = false
  }
}

async function share() {
  busy.value = true
  error.value = ''
  try {
    try { await chrome.storage.local.set({ [AUTHOR_KEY]: author.value.trim() }) } catch { /* ignore */ }
    const s = await addSnippet(props.stack, de.value, { name: newName.value, sql: props.currentSql, author: author.value.trim() })
    snippets.value = [s, ...snippets.value]
    adding.value = false
    newName.value = ''
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function remove(s) {
  if (!confirm(`Delete the shared snippet "${s.name}" for everyone in this business unit?`)) return
  try {
    await deleteSnippet(props.stack, de.value, s)
    snippets.value = snippets.value.filter((x) => x.id !== s.id)
  } catch (e) {
    error.value = e.message
  }
}

const mine = (s) => !!author.value.trim() && s.author.trim().toLowerCase() === author.value.trim().toLowerCase()
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return snippets.value.filter((s) => !q || `${s.name} ${s.author} ${s.sql}`.toLowerCase().includes(q))
})
</script>

<template>
  <DialogRoot :open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-9999 bg-black/45" @click="emit('close')" />
      <DialogContent class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[95vw] max-h-[85vh] rounded-xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col text-xs focus:outline-none" @click.stop @escape-key-down="emit('close')">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <DialogTitle class="text-sm font-bold">Shared snippets</DialogTitle>
          <span class="text-muted-foreground">in {{ SNIPPET_DE }}, for everyone in this business unit</span>
          <Button variant="ghost" size="icon" class="h-6 w-6 ml-auto" title="Reload" :disabled="loading || !de" @click="load"><RefreshCw class="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" class="h-6 w-6" title="Close" @click="emit('close')"><X class="h-3.5 w-3.5" /></Button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="loading" class="flex items-center gap-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Reading snippets...</div>
          <template v-else-if="missing">
            <p>This business unit has no <b>{{ SNIPPET_DE }}</b> data extension yet. Create it in the Data Extensions folder to start sharing snippets; anyone with access to the data extension can then read and add them.</p>
            <Button size="sm" class="h-8 text-xs" :disabled="busy" @click="create"><Loader2 v-if="busy" class="h-3.5 w-3.5 mr-1 animate-spin" /> Create {{ SNIPPET_DE }}</Button>
          </template>
          <template v-else-if="de">
            <div class="flex items-center gap-2">
              <Input v-model="filter" class="h-8 text-xs flex-1" placeholder="Filter by name, author or SQL" />
              <Button size="sm" class="h-8 text-xs" :disabled="!currentSql.trim()" title="Share the selected SQL, or the whole query when nothing is selected" @click="adding = !adding"><Plus class="h-3.5 w-3.5 mr-1" /> Share</Button>
            </div>
            <div v-if="adding" class="rounded-lg border border-border p-2 space-y-2">
              <div class="flex gap-2">
                <Input v-model="newName" class="h-8 text-xs flex-1" placeholder="Snippet name" />
                <Input v-model="author" class="h-8 text-xs w-40" placeholder="Your name" />
              </div>
              <pre class="max-h-28 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{{ currentSql }}</pre>
              <div class="flex justify-end"><Button size="sm" class="h-7 text-xs" :disabled="busy || !newName.trim()" @click="share">Share with the team</Button></div>
            </div>
            <div v-if="!shown.length" class="text-muted-foreground">{{ snippets.length ? 'No snippet matches.' : 'No shared snippets yet.' }}</div>
            <div v-for="s in shown" :key="s.id" class="rounded-lg border border-border">
              <div class="flex items-center gap-2 px-2 py-1.5 border-b border-border">
                <span class="font-semibold truncate">{{ s.name }}</span>
                <span class="text-muted-foreground truncate">{{ s.author }}{{ s.created ? ' · ' + String(s.created).slice(0, 10) : '' }}</span>
                <Button size="sm" class="h-6 text-[10px] ml-auto" @click="emit('insert', s.sql)">Insert</Button>
                <Button v-if="mine(s)" variant="ghost" size="icon" class="h-6 w-6 hover:text-red-600" title="Delete (for everyone)" @click="remove(s)"><Trash2 class="h-3 w-3" /></Button>
              </div>
              <pre class="max-h-24 overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">{{ s.sql }}</pre>
            </div>
            <p class="text-muted-foreground">New snippets reach the data extension in the background; others see them after a reload.</p>
          </template>
          <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
