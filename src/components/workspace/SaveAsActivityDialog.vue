<script setup>
// Save as query activity (feedback #88): name the activity, pick or name its target
// data extension and both folders, choose how rows are written, check, then create.
// Nothing is run or scheduled.
import { computed, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import { Loader2, X, Database, ExternalLink, AlertTriangle, Info, XCircle } from 'lucide-vue-next'
import Button from '../ui/button/Button.vue'
import Input from '../ui/input/Input.vue'
import DEFolderPicker from '../data/DEFolderPicker.vue'
import { searchDEsAllSources } from '../../utils/sfmcApi.js'
import { fetchDEFieldList } from '../../utils/deApi.js'
import { checkTarget } from '../../utils/targetChecks.js'
import {
  UPDATE_TYPE_OPTIONS, loadQAFolders, checkSaveForm, saveAsQueryActivity,
} from '../../utils/saveAsActivity.js'
import { openInSfmc } from '../../utils/sfmcLinks.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  stack: { type: String, default: null },
  sql: { type: String, default: '' },
  defaultName: { type: String, default: '' },
  resolveFields: { type: Function, required: true },
  cleanSql: { type: Function, required: true },
})
const emit = defineEmits(['close'])

const form = ref(blankForm())
function blankForm() {
  return { activityName: '', targetMode: 'new', deName: '', deFolderId: null, existingDE: null, qaFolderId: null, updateType: 0 }
}
const step = ref('form') // form | confirm | saving | done
const error = ref('')
const result = ref(null)

// ── Folders ──
const qaFolders = ref([])
const deFolderPath = ref('') // shown path of the picked DE folder (DEFolderPicker)
const loadingFolders = ref(false)

async function loadFolders() {
  loadingFolders.value = true
  error.value = ''
  try {
    const qa = await loadQAFolders(props.stack)
    qaFolders.value = qa
    if (form.value.qaFolderId == null) form.value.qaFolderId = qa.find((f) => f.depth === 0)?.id ?? null
  } catch (e) {
    error.value = `Could not read the folders: ${e.message}`
  } finally {
    loadingFolders.value = false
  }
}

// ── Existing DE search ──
const deQuery = ref('')
const deResults = ref([])
const deSearching = ref(false)
let searchTimer = null
watch(deQuery, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) { deResults.value = []; return }
  searchTimer = setTimeout(async () => {
    deSearching.value = true
    try {
      deResults.value = ((await searchDEsAllSources(props.stack, q.trim(), 25))?.items || []).slice(0, 25)
    } catch (e) {
      error.value = `Search failed: ${e.message}`
    } finally {
      deSearching.value = false
    }
  }, 300)
})

watch(() => props.open, (o) => {
  if (!o) return
  form.value = { ...blankForm(), activityName: props.defaultName || '', deName: props.defaultName ? props.defaultName.replace(/[^A-Za-z0-9_ -]/g, '').trim() : '' }
  deFolderPath.value = ''
  step.value = 'form'
  error.value = ''
  result.value = null
  deQuery.value = ''
  if (props.stack) loadFolders()
}, { immediate: true })

const qaFolderPath = computed(() => qaFolders.value.find((f) => f.id === form.value.qaFolderId)?.path || '')
const updateLabel = computed(() => UPDATE_TYPE_OPTIONS.find((o) => o.id === Number(form.value.updateType))?.label || '')

// Checks against the target (required fields, key, types, lengths, data action),
// shown on the review step. They never block: the user may know better.
const checks = ref([])
const checking = ref(false)
async function runChecks() {
  checks.value = []
  checking.value = true
  try {
    const out = (await props.resolveFields(props.sql))?.fields || []
    const existing = form.value.targetMode === 'existing'
    const targetFields = existing ? await fetchDEFieldList(props.stack, form.value.existingDE.id) : out
    checks.value = checkTarget({
      sql: props.sql, outFields: out, targetFields, updateType: Number(form.value.updateType),
      targetName: existing ? form.value.existingDE.name : form.value.deName, newTarget: !existing,
    })
  } catch (e) {
    checks.value = [{ level: 'info', text: `The target could not be checked (${e.message}).` }]
  } finally {
    checking.value = false
  }
}

function review() {
  error.value = checkSaveForm({ ...form.value, updateType: Number(form.value.updateType) })
  if (!props.sql.trim()) error.value = 'The editor is empty.'
  if (!error.value) { step.value = 'confirm'; runChecks() }
}

async function create() {
  step.value = 'saving'
  error.value = ''
  try {
    result.value = await saveAsQueryActivity(props.stack, { ...form.value, updateType: Number(form.value.updateType) }, {
      sql: props.sql, resolveFields: props.resolveFields, cleanSql: props.cleanSql,
    })
    step.value = 'done'
  } catch (e) {
    error.value = e.message
    step.value = 'confirm'
  }
}

const activityUrl = computed(() => result.value && `https://mc.${props.stack}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/${result.value.activity.id}`)
const deUrl = computed(() => result.value && `https://mc.${props.stack}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${result.value.de.id}/properties/`)
</script>

<template>
  <DialogRoot :open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-9999 bg-black/45" @click="step !== 'saving' && emit('close')" />
      <DialogContent class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-[95vw] max-h-[85vh] rounded-xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col text-xs focus:outline-none" @click.stop @escape-key-down="step !== 'saving' && emit('close')">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <DialogTitle class="text-sm font-bold">Save as query activity</DialogTitle>
          <Button variant="ghost" size="icon" class="h-6 w-6" title="Close" :disabled="step === 'saving'" @click="emit('close')"><X class="h-3.5 w-3.5" /></Button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <template v-if="step === 'form'">
            <label class="block space-y-1">
              <span class="font-semibold">Query activity name</span>
              <Input v-model="form.activityName" class="h-8 text-xs" />
            </label>

            <div class="space-y-1">
              <span class="font-semibold">Query activity folder</span>
              <div v-if="loadingFolders" class="flex items-center gap-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Reading folders...</div>
              <select v-else v-model="form.qaFolderId" class="w-full h-8 border border-border rounded px-2 bg-background" aria-label="Query activity folder">
                <option v-for="f in qaFolders" :key="f.id" :value="f.id">{{ '  '.repeat(f.depth) + f.name }}</option>
              </select>
            </div>

            <fieldset class="space-y-2">
              <legend class="font-semibold mb-1">Target data extension</legend>
              <div class="flex gap-4">
                <label class="flex items-center gap-1.5"><input v-model="form.targetMode" type="radio" value="new" /> New data extension</label>
                <label class="flex items-center gap-1.5"><input v-model="form.targetMode" type="radio" value="existing" /> Existing data extension</label>
              </div>

              <template v-if="form.targetMode === 'new'">
                <label class="block space-y-1">
                  <span class="text-muted-foreground">Name (its fields come from the query's columns)</span>
                  <Input v-model="form.deName" class="h-8 text-xs" />
                </label>
                <DEFolderPicker v-model="form.deFolderId" v-model:path="deFolderPath" :stack="stack" @error="(m) => (error = m)" />
              </template>

              <template v-else>
                <Input v-model="deQuery" class="h-8 text-xs" placeholder="Search data extensions by name" aria-label="Search data extensions" />
                <div v-if="form.existingDE" class="text-muted-foreground">Picked: <b class="text-foreground">{{ form.existingDE.name }}</b></div>
                <div class="max-h-40 overflow-y-auto border border-border rounded p-1">
                  <div v-if="deSearching" class="flex items-center gap-1 p-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Searching...</div>
                  <button v-for="d in deResults" :key="d.id" class="w-full flex items-center gap-1.5 px-1 py-1 rounded text-left" :class="form.existingDE?.id === d.id ? 'bg-primary/10' : 'hover:bg-muted'" @click="form.existingDE = d">
                    <Database class="h-3 w-3 shrink-0" /><span class="truncate flex-1">{{ d.name }}</span>
                    <span v-if="d.sourceType" class="text-[9px] px-1 rounded bg-muted">{{ d.sourceType }}</span>
                  </button>
                  <div v-if="!deSearching && deQuery.trim() && !deResults.length" class="p-1 text-muted-foreground italic">No matches</div>
                </div>
              </template>
            </fieldset>

            <label class="block space-y-1">
              <span class="font-semibold">Data action</span>
              <select v-model="form.updateType" class="w-full h-8 border border-border rounded px-2 bg-background">
                <option v-for="o in UPDATE_TYPE_OPTIONS" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
              <span class="text-muted-foreground">Update needs a primary key in the data extension.</span>
            </label>
          </template>

          <template v-else-if="step === 'confirm' || step === 'saving'">
            <p>This creates the following in SFMC. Nothing is run or scheduled.</p>
            <ul class="list-disc pl-5 space-y-1">
              <li v-if="form.targetMode === 'new'">Data extension <b>{{ form.deName.trim() }}</b> in <b>{{ deFolderPath }}</b>, with the query's columns as fields</li>
              <li v-else>Writes to the existing data extension <b>{{ form.existingDE?.name }}</b></li>
              <li>Query activity <b>{{ form.activityName.trim() }}</b> in <b>{{ qaFolderPath }}</b>, data action <b>{{ updateLabel }}</b></li>
            </ul>
            <div class="space-y-1">
              <div class="font-semibold">Checks against the target</div>
              <div v-if="checking" class="flex items-center gap-1 text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Checking...</div>
              <div v-else-if="!checks.length" class="text-green-700 dark:text-green-400">No problems found.</div>
              <div v-for="(c, i) in checks" :key="i" class="flex items-start gap-1.5 rounded border px-2 py-1"
                :class="c.level === 'error' ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300' : c.level === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-border text-muted-foreground'">
                <XCircle v-if="c.level === 'error'" class="h-3.5 w-3.5 shrink-0 mt-px" />
                <AlertTriangle v-else-if="c.level === 'warning'" class="h-3.5 w-3.5 shrink-0 mt-px" />
                <Info v-else class="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{{ c.text }}</span>
              </div>
            </div>
          </template>

          <template v-else-if="step === 'done' && result">
            <p class="font-semibold text-green-700 dark:text-green-400">Created.</p>
            <ul class="space-y-1">
              <li v-if="result.de.created">Data extension <b>{{ result.de.name }}</b> <a :href="deUrl" target="_blank" rel="noopener" class="text-primary inline-flex items-center gap-0.5 hover:underline" @click="openInSfmc($event, deUrl)">Open in SFMC <ExternalLink class="h-3 w-3" /></a></li>
              <li>Query activity <b>{{ result.activity.name }}</b> <a :href="activityUrl" target="_blank" rel="noopener" class="text-primary inline-flex items-center gap-0.5 hover:underline" @click="openInSfmc($event, activityUrl)">Open in SFMC <ExternalLink class="h-3 w-3" /></a></li>
            </ul>
          </template>

          <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
        </div>

        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <template v-if="step === 'form'">
            <Button variant="outline" size="sm" class="h-8 text-xs" @click="emit('close')">Cancel</Button>
            <Button size="sm" class="h-8 text-xs" :disabled="loadingFolders" @click="review">Review</Button>
          </template>
          <template v-else-if="step === 'confirm' || step === 'saving'">
            <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="step === 'saving'" @click="step = 'form'">Back</Button>
            <Button size="sm" class="h-8 text-xs" :disabled="step === 'saving'" @click="create">
              <Loader2 v-if="step === 'saving'" class="h-3.5 w-3.5 mr-1 animate-spin" /> {{ checks.some((c) => c.level === 'error') ? 'Create anyway' : 'Create in SFMC' }}
            </Button>
          </template>
          <Button v-else size="sm" class="h-8 text-xs" @click="emit('close')">Done</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
