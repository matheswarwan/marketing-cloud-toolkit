<script setup>
// Save results to a data extension: the rows loaded in the results go into an existing
// data extension (Append or Update) or a new one made from the query's columns.
import { computed, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import { Loader2, X, Database } from 'lucide-vue-next'
import Button from '../ui/button/Button.vue'
import Input from '../ui/input/Input.vue'
import DEFolderPicker from '../data/DEFolderPicker.vue'
import { searchDEsAllSources } from '../../utils/sfmcApi.js'
import { fetchDEFieldList } from '../../utils/deApi.js'
import { saveResultsToDE } from '../../utils/saveResults.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  stack: { type: String, default: null },
  rows: { type: Array, default: () => [] },
  totalCount: { type: Number, default: null },
  sql: { type: String, default: '' },
  defaultName: { type: String, default: '' },
  resolveFields: { type: Function, required: true },
})
const emit = defineEmits(['close'])

const targetMode = ref('existing')
const mode = ref('append')
const deName = ref('')
const deFolderId = ref(null)
const deFolderPath = ref('')
const existingDE = ref(null)
const deQuery = ref('')
const deResults = ref([])
const deSearching = ref(false)
const step = ref('form') // form | saving | done
const error = ref('')
const progress = ref({ done: 0, total: 0 })
const result = ref(null)

watch(() => props.open, (o) => {
  if (!o) return
  targetMode.value = 'existing'
  mode.value = 'append'
  deName.value = props.defaultName ? props.defaultName.replace(/[^A-Za-z0-9_ -]/g, '').trim() : ''
  existingDE.value = null
  deQuery.value = ''
  step.value = 'form'
  error.value = ''
  result.value = null
}, { immediate: true })

let timer = null
watch(deQuery, (q) => {
  clearTimeout(timer)
  if (!q.trim()) { deResults.value = []; return }
  timer = setTimeout(async () => {
    deSearching.value = true
    try { deResults.value = ((await searchDEsAllSources(props.stack, q.trim(), 25))?.items || []).slice(0, 25) }
    catch (e) { error.value = `Search failed: ${e.message}` }
    finally { deSearching.value = false }
  }, 300)
})

const partial = computed(() => props.totalCount != null && props.totalCount > props.rows.length)

async function save() {
  error.value = ''
  if (targetMode.value === 'existing' && !existingDE.value) { error.value = 'Pick the data extension.'; return }
  if (targetMode.value === 'new' && (!deName.value.trim() || deFolderId.value == null)) { error.value = 'Name the new data extension and pick its folder.'; return }
  step.value = 'saving'
  progress.value = { done: 0, total: props.rows.length }
  try {
    const onProgress = (done, total) => { progress.value = { done, total } }
    if (targetMode.value === 'existing') {
      const fields = await fetchDEFieldList(props.stack, existingDE.value.id)
      const key = existingDE.value.customerKey || existingDE.value.key
      result.value = await saveResultsToDE(props.stack, { target: { id: existingDE.value.id, key, name: existingDE.value.name, fields }, rows: props.rows, mode: mode.value, onProgress })
    } else {
      const target = await props.resolveFields(props.sql)
      if (!target?.fields?.length) throw new Error('Could not work out the columns for the new data extension.')
      result.value = await saveResultsToDE(props.stack, { create: { name: deName.value.trim(), categoryID: Number.parseInt(deFolderId.value, 10), fields: target.fields }, rows: props.rows, mode: 'append', onProgress })
    }
    step.value = 'done'
  } catch (e) {
    error.value = e.message
    step.value = 'form'
  }
}
</script>

<template>
  <DialogRoot :open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-9999 bg-black/45" @click="step !== 'saving' && emit('close')" />
      <DialogContent class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[95vw] max-h-[85vh] rounded-xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col text-xs focus:outline-none" @click.stop @escape-key-down="step !== 'saving' && emit('close')">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <DialogTitle class="text-sm font-bold">Save results to a data extension</DialogTitle>
          <Button variant="ghost" size="icon" class="h-6 w-6" title="Close" :disabled="step === 'saving'" @click="emit('close')"><X class="h-3.5 w-3.5" /></Button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <template v-if="step !== 'done'">
            <p>Copies the <b>{{ rows.length.toLocaleString() }}</b> rows loaded in the results.
              <span v-if="partial" class="text-amber-700 dark:text-amber-300">The query returned {{ totalCount.toLocaleString() }}: use Load all first to save every row.</span>
            </p>
            <div class="flex gap-4">
              <label class="flex items-center gap-1.5"><input v-model="targetMode" type="radio" value="existing" /> Existing data extension</label>
              <label class="flex items-center gap-1.5"><input v-model="targetMode" type="radio" value="new" /> New data extension</label>
            </div>
            <template v-if="targetMode === 'existing'">
              <Input v-model="deQuery" class="h-8 text-xs" placeholder="Search data extensions by name" aria-label="Search data extensions" />
              <div v-if="existingDE" class="text-muted-foreground">Picked: <b class="text-foreground">{{ existingDE.name }}</b></div>
              <div class="max-h-36 overflow-y-auto border border-border rounded p-1">
                <div v-if="deSearching" class="flex items-center gap-1 p-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Searching...</div>
                <button v-for="d in deResults" :key="d.id" class="w-full flex items-center gap-1.5 px-1 py-1 rounded text-left" :class="existingDE?.id === d.id ? 'bg-primary/10' : 'hover:bg-muted'" @click="existingDE = d">
                  <Database class="h-3 w-3 shrink-0" /><span class="truncate flex-1">{{ d.name }}</span>
                </button>
                <div v-if="!deSearching && deQuery.trim() && !deResults.length" class="p-1 text-muted-foreground italic">No matches</div>
              </div>
              <div class="flex gap-4">
                <label class="flex items-center gap-1.5"><input v-model="mode" type="radio" value="append" /> Append (add the rows)</label>
                <label class="flex items-center gap-1.5"><input v-model="mode" type="radio" value="upsert" /> Update (add or update by primary key)</label>
              </div>
            </template>
            <template v-else>
              <label class="block space-y-1">
                <span class="text-muted-foreground">Name (fields come from the query's columns)</span>
                <Input v-model="deName" class="h-8 text-xs" />
              </label>
              <DEFolderPicker v-model="deFolderId" v-model:path="deFolderPath" :stack="stack" @error="(m) => (error = m)" />
            </template>
            <p class="text-muted-foreground">Columns the data extension has no field for are left out. SFMC adds the rows in the background, so they can take a minute to show.</p>
            <div v-if="step === 'saving'" class="flex items-center gap-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Sent {{ progress.done.toLocaleString() }} of {{ progress.total.toLocaleString() }} rows...</div>
          </template>
          <template v-else-if="result">
            <p class="font-semibold text-green-700 dark:text-green-400">Sent {{ result.sent.toLocaleString() }} rows to {{ result.de.name }}{{ result.de.created ? ' (new)' : '' }}.</p>
            <p v-if="result.dropped.length" class="text-amber-700 dark:text-amber-300">Left out (no field in the data extension): {{ result.dropped.join(', ') }}</p>
            <p class="text-muted-foreground">SFMC processes them in the background; rows it refuses (wrong type, too long, duplicate key on Append) are not reported here.</p>
          </template>
          <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
        </div>
        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <template v-if="step !== 'done'">
            <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="step === 'saving'" @click="emit('close')">Cancel</Button>
            <Button size="sm" class="h-8 text-xs" :disabled="step === 'saving' || !rows.length" @click="save">
              <Loader2 v-if="step === 'saving'" class="h-3.5 w-3.5 mr-1 animate-spin" /> Save rows
            </Button>
          </template>
          <Button v-else size="sm" class="h-8 text-xs" @click="emit('close')">Done</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
