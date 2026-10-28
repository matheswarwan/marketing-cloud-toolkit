<script setup>
// Create DE (feedback #94): paste or upload a small sample (CSV, TSV, TXT, JSON,
// Parquet, Excel) or start with no file, check the guessed fields (name, type,
// length, primary key, required, default), set the data extension's name, folder
// (the last one used is remembered per stack and BU), sendable, testable and data
// retention, review, then create it in SFMC. The sample rows can be added too.
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, ref, watch } from 'vue'
import { Loader2, Upload, Plus, Trash2, ArrowUp, ArrowDown, ExternalLink, FileText, AlertTriangle, RotateCcw } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import DEFolderPicker from '@/components/data/DEFolderPicker.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import { openInSfmc } from '@/utils/sfmcLinks.js'
import {
  MAX_SAMPLE_ROWS, MAX_SAMPLE_BYTES, SAMPLE_ACCEPT, parseDelimitedSample, parseJsonSample, readSampleFile, fieldsFromSample,
} from '@/utils/createDE/sample.js'
import {
  FIELD_TYPES, RETENTION_MODES, RETENTION_UNITS, blankField, blankSettings, cellProblem, checkCreateForm, isFormValid,
  createDE, readLastFolder, saveLastFolder, rowsToLoad, lengthErrorField,
} from '@/utils/createDE/createDE.js'

const { stack } = useStack()

const source = ref('paste') // paste | file | none
const pasted = ref('')
const delimiter = ref('') // '' = detect
const reading = ref(false)
const readError = ref('')
const sample = ref(null) // { columns, rows, truncated, kind, delimiter, sheet }
const fileName = ref('')
const dragging = ref(false)

const fields = ref([]) // { ...field, src: sample column index or null }
const settings = ref(blankSettings())
const step = ref('edit') // edit | confirm | saving | done
const error = ref('')
const loadRows = ref(true)
const result = ref(null)
const buId = ref(null)

const DELIMS = [
  { id: '', label: 'Detect' }, { id: ',', label: 'Comma' }, { id: '\t', label: 'Tab' }, { id: ';', label: 'Semicolon' }, { id: '|', label: 'Pipe' },
]
const typeInfo = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]))

function useSample(table, name = '') {
  sample.value = table
  fileName.value = name
  fields.value = fieldsFromSample(table).map((f, i) => ({ ...f, src: i }))
  if (!settings.value.name && name) settings.value.name = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]+/g, '_').slice(0, 128)
  step.value = 'edit'
}

function readPasted() {
  readError.value = ''
  if (!pasted.value.trim()) { readError.value = 'Paste a few rows with a header row first.'; return }
  try {
    const text = pasted.value.trim()
    const table = /^[[{]/.test(text) ? parseJsonSample(text) : parseDelimitedSample(text, delimiter.value || undefined)
    if (!table.columns.length) throw new Error('No columns found.')
    useSample(table)
  } catch (e) {
    readError.value = `Could not read the text: ${e.message}`
  }
}

async function readFile(file) {
  if (!file) return
  readError.value = ''
  reading.value = true
  try {
    const table = await readSampleFile(file)
    if (!table.columns.length) throw new Error('No columns found.')
    useSample(table, file.name)
  } catch (e) {
    readError.value = `Could not read ${file.name}: ${e.message}`
  } finally {
    reading.value = false
  }
}

function onFileInput(e) { readFile(e.target.files?.[0]); e.target.value = '' }
function onDrop(e) { dragging.value = false; readFile(e.dataTransfer?.files?.[0]) }

function startEmpty() {
  sample.value = null
  fileName.value = ''
  fields.value = [{ ...blankField(1), src: null }]
  step.value = 'edit'
}

function addField() {
  fields.value = [...fields.value, { ...blankField(fields.value.length + 1), src: null }]
}
function removeField(i) {
  fields.value = fields.value.filter((_, j) => j !== i)
}
function moveField(i, by) {
  const j = i + by
  if (j < 0 || j >= fields.value.length) return
  const next = [...fields.value]
  ;[next[i], next[j]] = [next[j], next[i]]
  fields.value = next
}
function onTypeChange(f) {
  if (f.type === 'Text' && !f.length) f.length = 255
  if (f.type === 'Decimal') { if (!(Number(f.length) >= 1 && Number(f.length) <= 38)) f.length = 18; if (f.scale == null || f.scale === '') f.scale = 2 }
  if (!typeInfo[f.type].length) f.length = null
}
function onPrimaryKey(f) { if (f.isPrimaryKey) f.isNullable = false }

const check = computed(() => checkCreateForm(settings.value, fields.value))
const sendFields = computed(() => fields.value.filter((f) => ['Text', 'EmailAddress', 'Number'].includes(f.type)))

// Preview: the first 20 sample rows in field order, each cell checked against its field.
const PREVIEW_ROWS = 20
const preview = computed(() => {
  if (!sample.value) return []
  return sample.value.rows.slice(0, PREVIEW_ROWS).map((r) => fields.value.map((f) => {
    const v = f.src == null ? '' : r[f.src] ?? ''
    return { v, problem: cellProblem(v, f) }
  }))
})
const badCells = computed(() => {
  if (!sample.value) return 0
  let n = 0
  for (const r of sample.value.rows) fields.value.forEach((f) => { if (cellProblem(f.src == null ? '' : r[f.src], f)) n++ })
  return n
})
const loadPlan = computed(() => (sample.value ? rowsToLoad(fields.value, sample.value.rows, fields.value.map((f) => f.src)) : { items: [], skipped: 0 }))

// Remember the folder per stack and BU.
async function restoreFolder() {
  if (!stack.value) return
  const bu = await fetchCurrentBU(stack.value).catch(() => null)
  buId.value = bu?.accountId ?? null
  const last = await readLastFolder(stack.value, buId.value)
  if (last && settings.value.folderId == null) { settings.value.folderId = last.id; settings.value.folderPath = last.path }
}
whenStack(restoreFolder)
watch(stack, () => { settings.value.folderId = null; settings.value.folderPath = ''; restoreFolder() })

function review() {
  error.value = ''
  const c = check.value
  if (!isFormValid(c)) {
    const i = c.fields.findIndex(Boolean)
    error.value = c.form[0] || `Field ${i + 1} (${fields.value[i].name || 'no name'}): ${c.fields[i]}`
    return
  }
  step.value = 'confirm'
}

async function create() {
  step.value = 'saving'
  error.value = ''
  try {
    const withRows = !!sample.value && loadRows.value
    result.value = await createDE(stack.value, settings.value, fields.value, {
      rows: withRows ? sample.value.rows : null,
      columnIndex: fields.value.map((f) => f.src),
    })
    saveLastFolder(stack.value, buId.value, { id: settings.value.folderId, path: settings.value.folderPath })
    step.value = 'done'
  } catch (e) {
    error.value = `SFMC did not create the data extension: ${e.message}`
    step.value = 'confirm'
  }
}

// SFMC sometimes wants a length on a field it will not take one for (feedback #131,
// an EmailAddress primary key): offer to make that field Text (254) and try again.
const textFix = computed(() => {
  const name = lengthErrorField(error.value)
  if (!name) return null
  return fields.value.find((f) => String(f.name).trim().toLowerCase() === name.toLowerCase() && f.type !== 'Text') || null
})
function retryAsText() {
  const f = textFix.value
  if (!f) return
  f.type = 'Text'
  f.length = 254
  create()
}

function startOver() {
  const keep = { folderId: settings.value.folderId, folderPath: settings.value.folderPath }
  settings.value = { ...blankSettings(), ...keep }
  fields.value = []
  sample.value = null
  pasted.value = ''
  fileName.value = ''
  result.value = null
  error.value = ''
  step.value = 'edit'
}

const deUrl = computed(() => result.value?.de?.id && `https://mc.${stack.value}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${result.value.de.id}/properties/`)
const toolkitLink = computed(() => result.value && `/data-extensions?q=${encodeURIComponent(result.value.de.name)}`)
const retentionLabel = computed(() => {
  const r = settings.value.retention
  if (r.mode === 'off') return 'Off'
  const unit = RETENTION_UNITS.find((u) => u.id === Number(r.unit))?.label || ''
  return `${RETENTION_MODES.find((m) => m.id === r.mode)?.label} after ${r.length} ${unit}${r.resetOnImport ? ', reset on import' : ''}`
})
const maxMB = Math.round(MAX_SAMPLE_BYTES / 1048576)
</script>

<template>
  <div class="h-full overflow-y-auto p-4 space-y-4 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-base font-semibold flex-1">Create a data extension</h1>
      <Button v-if="fields.length || step === 'done'" variant="outline" size="sm" class="h-8 text-xs" @click="startOver"><RotateCcw class="h-3.5 w-3.5 mr-1" /> Start over</Button>
    </div>

    <template v-if="step === 'edit'">
      <!-- 1. Sample -->
      <section class="rounded-lg border border-border bg-card p-3 space-y-3">
        <h2 class="text-xs font-semibold">1. Sample data (optional)</h2>
        <div class="flex flex-wrap gap-4 text-xs" role="radiogroup" aria-label="Where the fields come from">
          <label class="flex items-center gap-1.5"><input v-model="source" type="radio" value="paste" /> Paste rows</label>
          <label class="flex items-center gap-1.5"><input v-model="source" type="radio" value="file" /> Upload a file</label>
          <label class="flex items-center gap-1.5"><input v-model="source" type="radio" value="none" /> No sample: add fields by hand</label>
        </div>

        <div v-if="source === 'paste'" class="space-y-2">
          <textarea v-model="pasted" rows="6" class="w-full rounded border border-border bg-background p-2 font-mono text-xs" placeholder="Paste a header row and a few rows (CSV, tab separated, semicolon or pipe), or a JSON array" aria-label="Sample rows" />
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <label class="flex items-center gap-1">Separator
              <select v-model="delimiter" class="h-8 border border-border rounded px-2 bg-background" aria-label="Separator">
                <option v-for="d in DELIMS" :key="d.label" :value="d.id">{{ d.label }}</option>
              </select>
            </label>
            <Button size="sm" class="h-8 text-xs" @click="readPasted"><FileText class="h-3.5 w-3.5 mr-1" /> Read sample</Button>
          </div>
        </div>

        <div v-else-if="source === 'file'" class="space-y-2">
          <label class="flex flex-col items-center justify-center gap-1 rounded border-2 border-dashed p-6 text-xs cursor-pointer" :class="dragging ? 'border-primary bg-primary/5' : 'border-border'"
            @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
            <Loader2 v-if="reading" class="h-5 w-5 animate-spin" /><Upload v-else class="h-5 w-5" />
            <span>Drop a file here or click to pick one</span>
            <span class="text-muted-foreground">CSV, TSV, TXT, JSON, Parquet, Excel (.xlsx, .xls: first sheet)</span>
            <input type="file" class="sr-only" :accept="SAMPLE_ACCEPT" aria-label="Sample file" @change="onFileInput" />
          </label>
        </div>

        <div v-else>
          <Button size="sm" class="h-8 text-xs" @click="startEmpty"><Plus class="h-3.5 w-3.5 mr-1" /> Start with one field</Button>
        </div>

        <p class="text-[11px] text-muted-foreground">Only the start of a sample is read: the first {{ MAX_SAMPLE_ROWS.toLocaleString() }} rows, {{ maxMB }} MB at most. Values stay in this browser unless you choose to add them to the new data extension.</p>
        <p v-if="readError" class="text-xs text-red-600" role="alert">{{ readError }}</p>
        <p v-if="sample" class="text-xs text-muted-foreground">
          Read {{ sample.rows.length.toLocaleString() }} row(s) and {{ sample.columns.length }} column(s){{ fileName ? ` from ${fileName}` : '' }}{{ sample.sheet ? ` (sheet ${sample.sheet})` : '' }}{{ sample.truncated ? '; the rest of the file was not read' : '' }}.
        </p>
      </section>

      <!-- 2. Fields -->
      <section v-if="fields.length" class="rounded-lg border border-border bg-card p-3 space-y-2">
        <div class="flex items-center gap-2">
          <h2 class="text-xs font-semibold flex-1">2. Fields ({{ fields.length }})</h2>
          <Button variant="outline" size="sm" class="h-7 text-xs" @click="addField"><Plus class="h-3.5 w-3.5 mr-1" /> Add field</Button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[820px] text-xs">
            <thead class="text-left text-muted-foreground">
              <tr>
                <th class="p-1 w-14"></th><th class="p-1">Name</th><th class="p-1">Type</th><th class="p-1 w-20">Length</th><th class="p-1 w-20">Decimals</th>
                <th class="p-1 text-center">Primary key</th><th class="p-1 text-center">Required</th><th class="p-1">Default value</th><th class="p-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(f, i) in fields" :key="i">
                <tr class="border-t border-border align-top">
                  <td class="p-1 whitespace-nowrap">
                    <button type="button" class="p-0.5 rounded hover:bg-muted disabled:opacity-30" :disabled="i === 0" :aria-label="`Move ${f.name} up`" @click="moveField(i, -1)"><ArrowUp class="h-3 w-3" /></button>
                    <button type="button" class="p-0.5 rounded hover:bg-muted disabled:opacity-30" :disabled="i === fields.length - 1" :aria-label="`Move ${f.name} down`" @click="moveField(i, 1)"><ArrowDown class="h-3 w-3" /></button>
                  </td>
                  <td class="p-1">
                    <Input v-model="f.name" class="h-7 text-xs min-w-40" :aria-label="`Field ${i + 1} name`" />
                    <div v-if="f.sourceName && f.sourceName !== f.name" class="text-[10px] text-muted-foreground mt-0.5">Column: {{ f.sourceName }}</div>
                  </td>
                  <td class="p-1">
                    <select v-model="f.type" class="h-7 border border-border rounded px-1 bg-background" :aria-label="`Field ${i + 1} type`" @change="onTypeChange(f)">
                      <option v-for="t in FIELD_TYPES" :key="t.id" :value="t.id">{{ t.id }}</option>
                    </select>
                  </td>
                  <td class="p-1"><Input v-if="typeInfo[f.type]?.length" v-model.number="f.length" type="number" min="1" :max="f.type === 'Decimal' ? 38 : 4000" class="h-7 text-xs min-w-20 px-2" :aria-label="`Field ${i + 1} length`" :placeholder="f.type === 'Text' ? '4000' : ''" /></td>
                  <td class="p-1"><Input v-if="f.type === 'Decimal'" v-model.number="f.scale" type="number" min="0" :max="f.length" class="h-7 text-xs min-w-16 px-2" :aria-label="`Field ${i + 1} decimal places`" /></td>
                  <td class="p-1 text-center"><input v-model="f.isPrimaryKey" type="checkbox" :aria-label="`Field ${i + 1} primary key`" @change="onPrimaryKey(f)" /></td>
                  <td class="p-1 text-center"><input type="checkbox" :checked="!f.isNullable" :disabled="f.isPrimaryKey" :aria-label="`Field ${i + 1} required`" @change="f.isNullable = !$event.target.checked" /></td>
                  <td class="p-1">
                    <div class="flex items-center gap-2">
                      <Input v-model="f.defaultValue" class="h-7 text-xs min-w-28" :disabled="f.type === 'Date' && f.currentDate"
                        :placeholder="f.type === 'Date' && f.currentDate ? 'Current date' : ''" :aria-label="`Field ${i + 1} default value`" />
                      <label v-if="f.type === 'Date'" class="flex items-center gap-1 whitespace-nowrap text-[11px]" title="The date and time the row is added">
                        <input v-model="f.currentDate" type="checkbox" :aria-label="`Field ${i + 1} defaults to the current date`" /> Current date
                      </label>
                    </div>
                  </td>
                  <td class="p-1"><button type="button" class="p-1 rounded hover:bg-muted" :aria-label="`Remove ${f.name}`" @click="removeField(i)"><Trash2 class="h-3.5 w-3.5" /></button></td>
                </tr>
                <tr v-if="check.fields[i]"><td></td><td colspan="8" class="px-1 pb-1 text-[11px] text-red-600">{{ check.fields[i] }}</td></tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Preview -->
      <section v-if="sample && fields.length" class="rounded-lg border border-border bg-card p-3 space-y-2">
        <h2 class="text-xs font-semibold">Sample with these fields <span class="font-normal text-muted-foreground">(first {{ Math.min(PREVIEW_ROWS, sample.rows.length) }} of {{ sample.rows.length.toLocaleString() }} rows)</span></h2>
        <p v-if="badCells" class="text-xs text-amber-700 dark:text-amber-400"><AlertTriangle class="inline h-3.5 w-3.5 mr-1" />{{ badCells.toLocaleString() }} value(s) in the sample do not fit their field (marked below; hover for why).</p>
        <div class="overflow-x-auto max-h-72 border border-border rounded">
          <table class="text-xs">
            <thead class="sticky top-0 bg-muted text-left"><tr><th v-for="(f, i) in fields" :key="i" class="px-2 py-1 whitespace-nowrap">{{ f.name }} <span class="font-normal text-muted-foreground">{{ f.type }}</span></th></tr></thead>
            <tbody>
              <tr v-for="(r, ri) in preview" :key="ri" class="border-t border-border">
                <td v-for="(c, ci) in r" :key="ci" class="px-2 py-0.5 whitespace-nowrap max-w-64 truncate" :class="c.problem ? 'bg-red-500/10 text-red-700 dark:text-red-300' : ''" :title="c.problem || c.v">{{ c.v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 3. Settings -->
      <section v-if="fields.length" class="rounded-lg border border-border bg-card p-3 space-y-3 text-xs">
        <h2 class="font-semibold">3. Data extension</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block space-y-1"><span class="text-muted-foreground">Name</span><Input v-model="settings.name" class="h-8 text-xs" aria-label="Data extension name" /></label>
          <label class="block space-y-1"><span class="text-muted-foreground">External key (empty: SFMC makes one)</span><Input v-model="settings.key" class="h-8 text-xs" aria-label="External key" /></label>
          <label class="block space-y-1 sm:col-span-2"><span class="text-muted-foreground">Description</span><Input v-model="settings.description" class="h-8 text-xs" aria-label="Description" /></label>
        </div>
        <DEFolderPicker v-model="settings.folderId" v-model:path="settings.folderPath" :stack="stack" @error="(m) => (error = m)" />
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-1.5"><input v-model="settings.isSendable" type="checkbox" /> Sendable</label>
          <label v-if="settings.isSendable" class="flex items-center gap-1">relates
            <select v-model="settings.sendField" class="h-8 border border-border rounded px-2 bg-background" aria-label="Send relationship field">
              <option value="">Pick a field</option>
              <option v-for="f in sendFields" :key="f.name" :value="f.name">{{ f.name }}</option>
            </select>
            to Subscriber Key
          </label>
          <label class="flex items-center gap-1.5"><input v-model="settings.isTestable" type="checkbox" /> Testable</label>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">Data retention</span>
          <select v-model="settings.retention.mode" class="h-8 border border-border rounded px-2 bg-background" aria-label="Data retention">
            <option v-for="m in RETENTION_MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <template v-if="settings.retention.mode !== 'off'">
            after <Input v-model.number="settings.retention.length" type="number" min="1" max="999" class="h-8 w-20 text-xs" aria-label="Retention period" />
            <select v-model.number="settings.retention.unit" class="h-8 border border-border rounded px-2 bg-background" aria-label="Retention unit">
              <option v-for="u in RETENTION_UNITS" :key="u.id" :value="u.id">{{ u.label }}</option>
            </select>
            <label class="flex items-center gap-1.5"><input v-model="settings.retention.resetOnImport" type="checkbox" /> Reset the period on import</label>
          </template>
        </div>
      </section>

      <div v-if="fields.length" class="flex items-center gap-2">
        <Button size="sm" class="h-8 text-xs" :disabled="!stack" @click="review">Review</Button>
        <span v-if="!stack" class="text-xs text-muted-foreground">Connect to Marketing Cloud first.</span>
        <span v-if="error" class="text-xs text-red-600" role="alert">{{ error }}</span>
      </div>
    </template>

    <!-- Review -->
    <section v-else-if="step === 'confirm' || step === 'saving'" class="rounded-lg border border-border bg-card p-3 space-y-3 text-xs">
      <h2 class="font-semibold">Check before creating</h2>
      <ul class="list-disc pl-5 space-y-1">
        <li>Data extension <b>{{ settings.name.trim() }}</b>{{ settings.key.trim() ? ` (key ${settings.key.trim()})` : '' }} in <b>{{ settings.folderPath }}</b></li>
        <li>{{ fields.length }} field(s): {{ fields.map((f) => `${f.name.trim()} (${f.type}${f.type === 'Text' && f.length ? ' ' + f.length : ''}${f.type === 'Decimal' ? ` ${f.length},${f.scale}` : ''}${f.isPrimaryKey ? ', primary key' : ''}${f.type === 'Date' && f.currentDate ? ', defaults to the current date' : ''})`).join(', ') }}</li>
        <li>Sendable: {{ settings.isSendable ? `yes, ${settings.sendField} relates to Subscriber Key` : 'no' }}. Testable: {{ settings.isTestable ? 'yes' : 'no' }}.</li>
        <li>Data retention: {{ retentionLabel }}</li>
      </ul>
      <label v-if="sample" class="flex items-center gap-1.5">
        <input v-model="loadRows" type="checkbox" />
        Also add the {{ loadPlan.items.length.toLocaleString() }} sample row(s){{ loadPlan.skipped ? ` (${loadPlan.skipped.toLocaleString()} with values that do not fit are left out)` : '' }}
      </label>
      <ProgressBar v-if="step === 'saving'" indeterminate :label="sample && loadRows ? 'Creating the data extension and sending rows' : 'Creating the data extension'" class="max-w-md" />
      <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
      <div v-if="textFix && step !== 'saving'" class="rounded-md border border-border bg-muted/40 p-2 space-y-1.5">
        <p>SFMC would not take <b>{{ textFix.name.trim() }}</b> as {{ textFix.type }}{{ textFix.isPrimaryKey ? ' while it is the primary key' : '' }}. A Text field of 254 characters holds the same values (254 is the longest email address).</p>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="retryAsText">Make {{ textFix.name.trim() }} Text (254) and try again</Button>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="step === 'saving'" @click="step = 'edit'">Back</Button>
        <Button size="sm" class="h-8 text-xs" :disabled="step === 'saving'" @click="create">
          <Loader2 v-if="step === 'saving'" class="h-3.5 w-3.5 mr-1 animate-spin" /> Create in SFMC
        </Button>
      </div>
    </section>

    <!-- Done -->
    <section v-else-if="step === 'done' && result" class="rounded-lg border border-border bg-card p-3 space-y-2 text-xs" role="status">
      <h2 class="font-semibold">Created {{ result.de.name }}</h2>
      <p v-if="result.loaded">{{ result.loaded.toLocaleString() }} row(s) sent to SFMC; it adds them in the background, so they can take a minute to show.<span v-if="result.skipped"> {{ result.skipped.toLocaleString() }} row(s) were left out.</span></p>
      <p v-if="result.loadError" class="text-red-600" role="alert">The rows were not added: {{ result.loadError }}</p>
      <div class="flex flex-wrap gap-3">
        <a v-if="deUrl" :href="deUrl" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary hover:underline" @click="openInSfmc($event, deUrl)"><ExternalLink class="h-3.5 w-3.5" /> Open in Contact Builder</a>
        <router-link :to="toolkitLink" class="inline-flex items-center gap-1 text-primary hover:underline">Find it in Data Extensions</router-link>
      </div>
    </section>
  </div>
</template>
