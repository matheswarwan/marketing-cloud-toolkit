<script setup>
// Automation Templates (feedback #38): pick a template, fill in its options, read
// exactly what will be created, then create it in SFMC. Nothing is scheduled or run.
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { computed, reactive, ref, watch } from 'vue'
import { ExternalLink, Loader2, Check, X, ChevronRight } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import CodeView from '@/components/results/CodeView.vue'
import { useStack } from '@/composables/useStack.js'
import { TEMPLATES, createFromPlan, deleteCreated } from '@/utils/templates/index.js'
import { contactBuilderDEUrl, automationStudioUrl } from '@/utils/activityTypes.js'
import { QUERY_UPDATE_TYPES, fetchCurrentBU, listAutomationFolders } from '@/utils/sfmcApi.js'
import { loadQAFolders, qaFolderOptions } from '@/utils/saveAsActivity.js'
import { loadFeedbackContact } from '@/utils/feedbackContact.js'
import DEFolderPicker from '@/components/data/DEFolderPicker.vue'

const { stack } = useStack()
const picked = ref(TEMPLATES[0])
const values = reactive({})
const reset = (t) => { for (const k of Object.keys(values)) delete values[k]; Object.assign(values, JSON.parse(JSON.stringify(t.defaults))) }
reset(picked.value)
function pick(t) { picked.value = t; reset(t); progress.value = []; result.value = null; for (const k of Object.keys(sqlEdits)) delete sqlEdits[k] }

// Edited SQL per query (feedback #156); it replaces the template's SQL when creating.
const sqlEdits = reactive({})
const editing = reactive({})
const sqlOf = (q) => sqlEdits[q.ref] ?? q.sql
function planToCreate(p) {
  return { ...p, queries: p.queries.map((q) => (sqlEdits[q.ref] != null ? { ...q, sql: sqlEdits[q.ref] } : q)) }
}

const plan = computed(() => {
  try { return { ok: picked.value.plan({ ...values }) } } catch (e) { return { error: e.message } }
})
const shown = (opt) => !opt.showIf || values[opt.showIf]
function toggleChoice(key, choice) {
  const list = values[key]
  const i = list.indexOf(choice)
  i >= 0 ? list.splice(i, 1) : list.push(choice)
}

// Where things go (feedback #152): folders the user picks, and who gets the
// automation's emails. The business unit is named (feedback #153).
const bu = ref(null)
const deFolderId = ref(null)
const deFolderPath = ref('')
const qaFolders = ref([])
const qaFolderId = ref(null)
const autoFolders = ref([])
const autoFolderId = ref(null)
const notifyEmail = ref('')
const folderError = ref('')
async function loadWhere(s) {
  if (!s) return
  folderError.value = ''
  fetchCurrentBU(s).then((b) => { bu.value = b }).catch(() => { bu.value = null })
  loadQAFolders(s).then((list) => { qaFolders.value = list; if (qaFolderId.value == null) qaFolderId.value = list.find((f) => f.depth === 0)?.id ?? null })
    .catch((e) => { folderError.value = `Could not read the Query Activity folders: ${e.message}` })
  listAutomationFolders(s).then((r) => {
    autoFolders.value = qaFolderOptions(r?.items || [])
    if (autoFolderId.value == null) autoFolderId.value = autoFolders.value.find((f) => f.depth === 0)?.id ?? null
  }).catch(() => { autoFolders.value = [] })
}
watch(stack, loadWhere, { immediate: true })
loadFeedbackContact().then((c) => { if (!notifyEmail.value) notifyEmail.value = c.email || '' })
const buLabel = computed(() => (!stack.value ? 'no business unit yet (not connected to Marketing Cloud)' : bu.value ? `${bu.value.name}${bu.value.accountId ? ` (MID ${bu.value.accountId})` : ''}, stack ${stack.value}` : `the business unit you are logged in to, stack ${stack.value}`))

// The confirm step is a dialog (feedback #154), not the browser's alert.
const confirmOpen = ref(null) // 'create' | 'undo' | null

const creating = ref(false)
const progress = ref([])
const result = ref(null)

async function create() {
  const p = plan.value.ok && planToCreate(plan.value.ok)
  if (!p || !stack.value) return
  confirmOpen.value = null
  creating.value = true
  progress.value = []
  result.value = null
  undoFailed.value = null
  const r = await createFromPlan(stack.value, p, (entry) => {
    const i = progress.value.findIndex((x) => x.kind === entry.kind && x.name === entry.name)
    i >= 0 ? progress.value.splice(i, 1, entry) : progress.value.push(entry)
  }, { deFolderId: deFolderId.value, queryFolderId: qaFolderId.value, automationFolderId: autoFolderId.value, notifyEmail: notifyEmail.value })
  result.value = r
  creating.value = false
}

const KIND = { check: 'Check', de: 'Data extension', query: 'Query activity', automation: 'Automation', setup: 'Setup' }

// A stopped run leaves what it created; this removes it so the template can run again.
const undoing = ref(false)
const undoFailed = ref(null)
async function undo() {
  const created = result.value?.created || []
  if (!created.length) return
  confirmOpen.value = null
  undoing.value = true
  const failed = await deleteCreated(stack.value, created)
  undoing.value = false
  undoFailed.value = failed
  const left = new Set(failed.map((f) => f.kind + f.name))
  progress.value = progress.value.filter((e) => e.status !== 'done' || left.has(e.kind + e.name))
  result.value = { ...result.value, created: created.filter((c) => left.has(c.kind + c.name)) }
}
</script>

<template>
  <div class="h-full flex min-h-0">
    <nav class="w-64 shrink-0 border-r border-border bg-card p-3 space-y-1 overflow-y-auto" aria-label="Templates">
      <p class="px-2 pb-2 text-xs text-muted-foreground">Ready-made automations. The Toolkit creates them; you run them.</p>
      <button v-for="t in TEMPLATES" :key="t.id" class="w-full text-left px-2 py-2 rounded-md text-sm hover:bg-accent"
        :class="picked.id === t.id ? 'bg-accent font-medium' : ''" @click="pick(t)">
        <span class="flex items-center gap-1">{{ t.title }} <ChevronRight v-if="picked.id === t.id" class="h-3.5 w-3.5 ml-auto" /></span>
      </button>
    </nav>

    <div class="flex-1 min-w-0 overflow-y-auto p-5 space-y-5 text-sm">
      <header>
        <h1 class="text-lg font-semibold">{{ picked.title }}</h1>
        <p class="text-muted-foreground mt-1">{{ picked.summary }}</p>
        <a v-if="picked.source" :href="picked.source.url" target="_blank" rel="noopener" class="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline">
          Based on {{ picked.source.label }} <ExternalLink class="h-3 w-3" />
        </a>
      </header>

      <section v-if="picked.before?.length" class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3">
        <h2 class="font-semibold mb-1">Before you start</h2>
        <ol class="list-decimal pl-5 space-y-1 text-xs"><li v-for="(b, i) in picked.before" :key="i">{{ b }}</li></ol>
      </section>

      <section class="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 class="font-semibold">Options</h2>
        <template v-for="opt in picked.options" :key="opt.key">
          <div v-if="shown(opt)">
            <label v-if="opt.type === 'checkbox'" class="flex items-center gap-2 text-sm">
              <input v-model="values[opt.key]" type="checkbox" /> {{ opt.label }}
            </label>
            <div v-else-if="opt.type === 'multi'">
              <div class="text-xs font-medium mb-1">{{ opt.label }}</div>
              <div class="flex flex-wrap gap-3">
                <label v-for="c in opt.choices" :key="c" class="flex items-center gap-1.5 text-xs font-mono">
                  <input type="checkbox" :checked="values[opt.key].includes(c)" @change="toggleChoice(opt.key, c)" /> {{ c }}
                </label>
              </div>
            </div>
            <label v-else class="block">
              <span class="text-xs font-medium">{{ opt.label }}</span>
              <input v-if="opt.type === 'number'" v-model.number="values[opt.key]" type="number" :min="opt.min" :max="opt.max"
                class="mt-1 block h-8 w-24 rounded-md border border-border bg-background px-2 text-xs" />
              <input v-else v-model.trim="values[opt.key]" type="text" class="mt-1 block h-8 w-full max-w-md rounded-md border border-border bg-background px-2 text-xs" />
              <span v-if="opt.help" class="block text-xs text-muted-foreground mt-0.5">{{ opt.help }}</span>
            </label>
          </div>
        </template>
      </section>

      <section class="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 class="font-semibold">Where</h2>
        <p class="text-xs text-muted-foreground">In {{ buLabel }}.</p>
        <div class="grid gap-3 md:grid-cols-2">
          <div class="space-y-1 text-xs">
            <div class="font-medium">Data extension folder</div>
            <DEFolderPicker v-model="deFolderId" v-model:path="deFolderPath" :stack="stack" @error="(m) => (folderError = m)" />
            <p class="text-muted-foreground">None picked: the Data Extensions folder.</p>
          </div>
          <div class="space-y-3 text-xs">
            <label class="block space-y-1">
              <span class="font-medium">Query Activity folder</span>
              <select v-model="qaFolderId" class="w-full h-8 border border-border rounded px-2 bg-background">
                <option v-for="f in qaFolders" :key="f.id" :value="f.id">{{ '\u00a0\u00a0'.repeat(f.depth) + f.name }}</option>
              </select>
            </label>
            <label v-if="autoFolders.length" class="block space-y-1">
              <span class="font-medium">Automation folder</span>
              <select v-model="autoFolderId" class="w-full h-8 border border-border rounded px-2 bg-background">
                <option v-for="f in autoFolders" :key="f.id" :value="f.id">{{ '\u00a0\u00a0'.repeat(f.depth) + f.name }}</option>
              </select>
            </label>
            <label class="block space-y-1">
              <span class="font-medium">Email the automation's completion and errors to</span>
              <input v-model.trim="notifyEmail" type="email" class="w-full h-8 rounded-md border border-border bg-background px-2" placeholder="you@company.com (empty: no emails)" />
            </label>
          </div>
        </div>
        <p v-if="folderError" class="text-xs text-red-600">{{ folderError }}</p>
      </section>

      <section class="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 class="font-semibold">What will be created</h2>
        <p v-if="plan.error" class="text-red-600 text-xs" role="alert">{{ plan.error }}</p>
        <template v-else>
          <div>
            <div class="text-xs font-medium mb-1">Data extensions (in {{ deFolderPath || 'the Data Extensions folder' }})</div>
            <ul class="text-xs space-y-1">
              <li v-for="d in plan.ok.des" :key="d.ref">
                <span class="font-mono">{{ d.name }}</span>
                <span class="text-muted-foreground"> · key {{ d.key }} · {{ d.fields.length }} fields{{ d.sendableField ? ` · sendable (${d.sendableField} to Subscriber Key)` : '' }} · primary key {{ d.fields.filter((f) => f.isPrimaryKey).map((f) => f.name).join(', ') || 'none' }}</span>
              </li>
            </ul>
          </div>
          <div>
            <div class="text-xs font-medium mb-1">Query activities</div>
            <details v-for="q in plan.ok.queries" :key="q.ref" class="mb-1" open>
              <summary class="cursor-pointer text-xs">
                <span class="font-mono">{{ q.name }}</span>
                <span class="text-muted-foreground"> → {{ plan.ok.des.find((d) => d.ref === q.target)?.name }} ({{ QUERY_UPDATE_TYPES[q.updateType] }})</span>
              </summary>
              <div class="mt-1 space-y-1">
                <div class="flex items-center gap-3 text-[11px]">
                  <button class="text-primary hover:underline" @click="editing[q.ref] = !editing[q.ref]">{{ editing[q.ref] ? 'Done editing' : 'Edit SQL' }}</button>
                  <button v-if="sqlEdits[q.ref] != null" class="text-primary hover:underline" @click="delete sqlEdits[q.ref]; editing[q.ref] = false">Back to the template's SQL</button>
                  <span v-if="sqlEdits[q.ref] != null" class="text-amber-700 dark:text-amber-300">Edited: this SQL is used, and changing the options above no longer updates it.</span>
                </div>
                <textarea v-if="editing[q.ref]" :value="sqlOf(q)" rows="14" spellcheck="false"
                  class="w-full rounded-md border border-border bg-background p-2 font-mono text-[11px] resize-y"
                  @input="sqlEdits[q.ref] = $event.target.value" />
                <CodeView v-else :code="sqlOf(q)" lang="sql" />
              </div>
            </details>
          </div>
          <div>
            <div class="text-xs font-medium mb-1">Automation (not scheduled, not run)</div>
            <p class="text-xs font-mono">{{ plan.ok.automation.name }}</p>
            <ol class="list-decimal pl-5 text-xs text-muted-foreground">
              <li v-for="s in plan.ok.automation.steps" :key="s.name">{{ s.queries.map((r) => plan.ok.queries.find((q) => q.ref === r).name).join(', ') }}</li>
            </ol>
          </div>
          <div class="flex items-center gap-3">
            <Button size="sm" class="h-8 text-xs" :disabled="creating || !stack" @click="confirmOpen = 'create'">
              <Loader2 v-if="creating" class="h-3.5 w-3.5 mr-1 animate-spin" /> Create in SFMC
            </Button>
            <span class="text-xs text-muted-foreground">{{ stack ? `In ${buLabel}.` : 'Not connected to Marketing Cloud.' }}</span>
          </div>
        </template>
      </section>

      <section v-if="progress.length" class="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 class="font-semibold">{{ creating ? 'Creating...' : result?.failed ? 'Stopped' : 'Created' }}</h2>
        <ProgressBar v-if="creating" indeterminate :label="`${progress.filter((e) => e.status === 'done').length} done`" class="max-w-md" />
        <ul class="text-xs space-y-1">
          <li v-for="e in progress" :key="e.kind + e.name" class="flex items-start gap-2">
            <Loader2 v-if="e.status === 'creating'" class="h-3.5 w-3.5 mt-0.5 animate-spin shrink-0" />
            <Check v-else-if="e.status === 'done'" class="h-3.5 w-3.5 mt-0.5 text-green-600 shrink-0" />
            <X v-else class="h-3.5 w-3.5 mt-0.5 text-red-600 shrink-0" />
            <span>
              {{ KIND[e.kind] }} <span class="font-mono">{{ e.name }}</span>
              <a v-if="e.kind === 'de' && contactBuilderDEUrl(stack, e.id)" :href="contactBuilderDEUrl(stack, e.id)" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline">SFMC</a>
              <a v-if="e.kind === 'automation' && e.status === 'done'" :href="automationStudioUrl(stack)" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline">Automation Studio</a>
              <span v-if="e.error" class="block text-red-600 whitespace-pre-line">{{ e.error }}</span>
              <span v-if="e.note" class="block text-amber-700 dark:text-amber-400">{{ e.note }}</span>
            </span>
          </li>
        </ul>
        <div v-if="result?.failed && result.created.length" class="flex flex-wrap items-center gap-3 pt-1">
          <p class="text-xs text-muted-foreground flex-1 min-w-60">
            The items with a tick were created before it stopped. Delete them, fix the cause (for example the list or data extension name), then create again.
          </p>
          <Button size="sm" variant="outline" class="h-8 text-xs" :disabled="undoing" @click="confirmOpen = 'undo'">
            <Loader2 v-if="undoing" class="h-3.5 w-3.5 mr-1 animate-spin" /> Delete what was created
          </Button>
        </div>
        <p v-if="result?.failed && !result.created.length && result.failed.kind === 'check'" class="text-xs text-muted-foreground">Nothing was created. Fix the names above, or create the missing list or data extension, then try again.</p>
        <p v-if="undoFailed?.length" class="text-xs text-red-600 whitespace-pre-line">Not deleted (delete them in SFMC):\n{{ undoFailed.map((f) => `${KIND[f.kind]} ${f.name}: ${f.error}`).join('\n') }}</p>
      </section>

      <div v-if="confirmOpen && plan.ok" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="confirmOpen = null">
        <div class="w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-2xl p-5 space-y-3 text-sm" role="dialog" aria-modal="true">
          <template v-if="confirmOpen === 'create'">
            <h2 class="text-base font-semibold">Create in SFMC?</h2>
            <p class="text-xs text-muted-foreground">In {{ buLabel }}. Nothing is scheduled or run.</p>
            <ul class="text-xs list-disc pl-5 space-y-1">
              <li>{{ plan.ok.des.length }} data extension{{ plan.ok.des.length === 1 ? '' : 's' }} in {{ deFolderPath || 'the Data Extensions folder' }}</li>
              <li>{{ plan.ok.queries.length }} Query activit{{ plan.ok.queries.length === 1 ? 'y' : 'ies' }} in {{ qaFolders.find((f) => f.id === qaFolderId)?.path || 'the Query folder' }}</li>
              <li>The automation "{{ plan.ok.automation.name }}"{{ autoFolders.find((f) => f.id === autoFolderId) ? ` in ${autoFolders.find((f) => f.id === autoFolderId).path}` : '' }}{{ notifyEmail ? `, emailing ${notifyEmail} on completion and errors` : '' }}</li>
            </ul>
            <div class="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" class="h-8 text-xs" @click="confirmOpen = null">Cancel</Button>
              <Button size="sm" class="h-8 text-xs" @click="create">Create</Button>
            </div>
          </template>
          <template v-else>
            <h2 class="text-base font-semibold">Delete what this run created?</h2>
            <ul class="text-xs list-disc pl-5 space-y-0.5 max-h-60 overflow-y-auto"><li v-for="c in result?.created || []" :key="c.kind + c.name">{{ KIND[c.kind] }}: <span class="font-mono">{{ c.name }}</span></li></ul>
            <div class="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" class="h-8 text-xs" @click="confirmOpen = null">Cancel</Button>
              <Button variant="destructive" size="sm" class="h-8 text-xs" @click="undo">Delete</Button>
            </div>
          </template>
        </div>
      </div>

      <section v-if="result && !result.failed" class="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3">
        <h2 class="font-semibold mb-1">Next steps</h2>
        <ol class="list-decimal pl-5 space-y-1 text-xs"><li v-for="(a, i) in picked.after(values)" :key="i">{{ a }}</li></ol>
      </section>
    </div>
  </div>
</template>
