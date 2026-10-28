<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { LayoutGrid, List, Check, Loader2, FileInput, X, Share, CircleHelp, EyeOff, Code2, SlidersHorizontal, ChevronDown, ChevronRight } from 'lucide-vue-next'
import DEBrowser from './DEBrowser.vue'
import SelectedDEsPanel from './SelectedDEsPanel.vue'
import SqlOutput from './SqlOutput.vue'
import BuilderCanvas from './canvas/BuilderCanvas.vue'
import HelpTip from '@/components/ui/HelpTip.vue'
import { BUILDER_HELP, BUILDER_HELP_ORDER } from '@/data/builderHelp.js'
import WhereBuilder from './WhereBuilder.vue'
import QueryOptions from './QueryOptions.vue'
import OutputColumns from './OutputColumns.vue'
import { useStack } from '@/composables/useStack.js'
import { saveBuilderRecord, getBuilderRecord, listSavedQueryRecords, defaultQueryOptions, plainClone } from '@/utils/builderStorage.js'
import { resolveSelectionTables, fieldOptionsFromTables, buildSqlFromSelections } from '@/utils/sqlBuilder.js'
import { graphToModel } from '@/utils/builderOrder.js'
import { importSqlToBuilder } from '@/utils/builderImport.js'
import { listQueryActivities } from '@/utils/sfmcApi.js'
import { parseSqlForBuilder } from '@/utils/sqlToBuilder.js'
import { policy } from '@/utils/policy.js'
import { builderToDiagramforce, openInDiagramforce } from '@/utils/diagramforce.js'
import { showToast } from '@/composables/useToast.js'

const props = defineProps({
  // A saved Query Builder record to open, or null for a new query.
  openId: { type: String, default: null },
  // SQL to draw on open (Open in Query Builder from Run Query or Saved queries).
  importSql: { type: String, default: '' },
})
const emit = defineEmits(['saved'])

const { stack, state: stackState } = useStack()
// Visual is the default view; the last one used is remembered (feedback #150).
const VIEW_KEY = 'qb_view'
const visualMode = ref((() => { try { return localStorage.getItem(VIEW_KEY) !== 'list' } catch { return true } })())
watch(visualMode, (v) => { try { localStorage.setItem(VIEW_KEY, v ? 'visual' : 'list') } catch { /* ignore */ } })
const selectedDEs = ref([])
const joins = ref([])
const where = ref({ combinator: 'AND', conditions: [] })
const queryOptions = ref(defaultQueryOptions())
const generatedSql = ref('')
// Card positions on the visual canvas, by DE id (the canvas draws the List model).
const layout = ref({})

// UNION / EXCEPT / INTERSECT: one builder state per SELECT, shown as tabs. The active
// SELECT lives in the refs above; its slot in `branches` is refreshed when leaving it.
const SET_OPS = ['UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT']
const branches = ref([]) // [] for a single SELECT
const setOps = ref([]) // operator between branch i and i + 1
const activeBranch = ref(0)
const emptyState = () => ({ selectedDEs: [], joins: [], where: { combinator: 'AND', conditions: [] }, queryOptions: defaultQueryOptions(), layout: {} })
const currentState = () => plainClone({ selectedDEs: selectedDEs.value, joins: joins.value, where: where.value, queryOptions: queryOptions.value, layout: layout.value })
function allBranches() {
  if (branches.value.length < 2) return [currentState()]
  const b = [...branches.value]
  b[activeBranch.value] = currentState()
  return b
}
const branchSql = (st) => buildSqlFromSelections(st?.selectedDEs || [], st?.joins || [], st?.where, st?.queryOptions)
const sqlBefore = computed(() => {
  if (branches.value.length < 2) return ''
  const out = []
  for (let i = 0; i < activeBranch.value; i++) out.push(branchSql(branches.value[i]), setOps.value[i] || 'UNION ALL')
  return out.join('\n')
})
const sqlAfter = computed(() => {
  if (branches.value.length < 2) return ''
  const out = []
  for (let i = activeBranch.value + 1; i < branches.value.length; i++) out.push(setOps.value[i - 1] || 'UNION ALL', branchSql(branches.value[i]))
  return out.join('\n')
})
async function loadBranch(st) {
  restoring = true
  layout.value = st?.layout || {}
  await applyBuilderState(st || emptyState())
}
async function switchBranch(i) {
  if (i === activeBranch.value) return
  branches.value = allBranches()
  activeBranch.value = i
  await loadBranch(branches.value[i])
}
async function addBranch() {
  const b = allBranches()
  b.push(emptyState())
  setOps.value = [...setOps.value, 'UNION ALL']
  branches.value = b
  activeBranch.value = b.length - 1
  await loadBranch(b[b.length - 1])
}
async function removeBranch(i) {
  const b = allBranches()
  b.splice(i, 1)
  const ops = [...setOps.value]
  ops.splice(Math.max(0, i - 1), 1)
  setOps.value = b.length > 1 ? ops : []
  branches.value = b.length > 1 ? b : []
  activeBranch.value = Math.min(activeBranch.value > i ? activeBranch.value - 1 : activeBranch.value, b.length - 1)
  await loadBranch(b[activeBranch.value])
}
function setOp(i, v) { setOps.value = setOps.value.map((o, k) => (k === i ? v : o)) }
const recordId = ref(null)
const restoreNotice = ref('')

// Visual-mode "Filters & options" drawer.
const showVisualExtras = ref(false)
const visualFieldOptions = computed(() => fieldOptionsFromTables(resolveSelectionTables(selectedDEs.value)))

// Autosave state
const AUTOSAVE_IDLE_MS = 3000
const saveStatus = ref('') // '' | 'pending' | 'saving' | 'saved'
const lastSavedAt = ref(0)
let restoring = false
let autosaveTimer = null

const selectedPanelRef = ref(null)
const canvasRef = ref(null)

// SQL panel docking, remembered per mode: list defaults right, visual defaults bottom.
// The panel starts hidden (feedback #61): Generate SQL opens it, Hide SQL closes it.
// Help (feedback #150): ? icons, a Help panel, and tips on the first visit.
const helpOpen = ref(false)
const TIPS_KEY = 'qb_tips_seen'
const showTips = ref((() => { try { return !localStorage.getItem(TIPS_KEY) } catch { return false } })())
function closeTips() { showTips.value = false; try { localStorage.setItem(TIPS_KEY, '1') } catch { /* ignore */ } }

// The SQL panel sits at the bottom (feedback #150): collapsed to a bar, open, or
// maximized over the builder. Remembered.
const SQL_STATE_KEY = 'qb_sql_state_v3'
const SQL_STATES = ['collapsed', 'open', 'max']
const sqlState = ref((() => { try { const v = localStorage.getItem(SQL_STATE_KEY); return SQL_STATES.includes(v) ? v : 'collapsed' } catch { return 'collapsed' } })())
watch(sqlState, (v) => { try { localStorage.setItem(SQL_STATE_KEY, v) } catch { /* ignore */ } })
const sqlOpen = computed(() => sqlState.value !== 'collapsed')
function toggleSql() { sqlState.value = sqlOpen.value ? 'collapsed' : 'open' }

// Resizable SQL panel — width (%) when docked right, height (%) when bottom.
const SIZE_KEY = 'qb_sql_size_v1'
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const sqlSize = ref({ right: 38, bottom: 40 })
try {
  const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}')
  if (typeof saved.right === 'number') sqlSize.value.right = clamp(saved.right, 20, 75)
  if (typeof saved.bottom === 'number') sqlSize.value.bottom = clamp(saved.bottom, 15, 80)
} catch { /* ignore */ }

const rowRef = ref(null)
const stackRef = ref(null)
let activeResize = null

function startResize(kind, e) {
  e.preventDefault()
  const el = kind === 'right' ? rowRef.value : stackRef.value
  if (!el) return
  activeResize = { kind, rect: el.getBoundingClientRect() }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = kind === 'right' ? 'col-resize' : 'row-resize'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', endResize)
}

function onResizeMove(e) {
  if (!activeResize) return
  const { kind, rect } = activeResize
  if (kind === 'right') {
    const pct = ((rect.right - e.clientX) / rect.width) * 100
    sqlSize.value = { ...sqlSize.value, right: clamp(pct, 20, 75) }
  } else {
    const pct = ((rect.bottom - e.clientY) / rect.height) * 100
    sqlSize.value = { ...sqlSize.value, bottom: clamp(pct, 15, 80) }
  }
}

function endResize() {
  activeResize = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  try { localStorage.setItem(SIZE_KEY, JSON.stringify(sqlSize.value)) } catch { /* ignore */ }
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', endResize)
}

// Restoring a saved record does not depend on the SFMC connection.
onMounted(() => {
  if (props.openId) loadRecord(props.openId)
  else if (props.importSql) {
    // Tables are looked up in SFMC, so wait for the connection check (10 s at most).
    if (stackState.value !== 'detecting') return runImport(props.importSql)
    importBusy.value = true
    const stop = watch(stackState, (v) => { if (v !== 'detecting') { stop(); clearTimeout(t); runImport(props.importSql) } })
    const t = setTimeout(() => { stop(); runImport(props.importSql) }, 10000)
  }
})

// ── Subqueries in FROM ─────────────────────────────────────
// A card whose table is a SELECT in parentheses; its fields are the SELECT's columns.
const subEdit = ref(null) // { id, alias, text, error }
function openSubquery(id) {
  const de = id && selectedDEs.value.find((d) => d.id === id)
  subEdit.value = de
    ? { id, alias: de.alias || de.name, text: de.subquery || '', error: '' }
    : { id: null, alias: `sq${selectedDEs.value.filter((d) => d.sourceType === 'subquery').length + 1}`, text: '', error: '' }
}
function saveSubquery() {
  const e = subEdit.value
  const parsed = parseSqlForBuilder(e.text)
  if (parsed.error) { e.error = parsed.error; return }
  const names = parsed.columns.map((c) => c.as || c.field || '').filter(Boolean)
  if (!names.length || parsed.columns.some((c) => c.star)) { e.error = 'Name every column of the subquery (no *), so the card can list them. Give expressions an alias with AS.'; return }
  const alias = (e.alias || '').trim().replace(/\s+/g, '_') || 'sq'
  const fields = names.map((name) => ({ name }))
  if (e.id) {
    selectedDEs.value = selectedDEs.value.map((d) => (d.id !== e.id ? d : {
      ...d, subquery: e.text.trim(), alias, name: alias, fields,
      selectedFields: Array.isArray(d.selectedFields) ? d.selectedFields.filter((n) => names.includes(n)) : null,
    }))
  } else {
    const id = `sub:${alias.toLowerCase()}:${Date.now().toString(36)}`
    selectedPanelRef.value?.addDe({ id, name: alias, sourceType: 'subquery', subquery: e.text.trim(), fields })
  }
  subEdit.value = null
}

// ── Open in Diagramforce ───────────────────────────────────
const dfMenu = ref(false)
function toDiagramforce(mode, allFields = false) {
  dfMenu.value = false
  const diagram = builderToDiagramforce(
    { selectedDEs: selectedDEs.value, joins: joins.value, where: where.value, queryOptions: queryOptions.value, layout: layout.value },
    { mode, allFields, title: selectedDEs.value.map((d) => d.name).slice(0, 3).join(' + ') || 'Query' },
  )
  if (!openInDiagramforce(diagram)) showToast('The browser blocked the new tab. Allow pop-ups for the Toolkit and try again.')
}

// ── SQL to builder ─────────────────────────────────────────
const importOpen = ref(false)
const importText = ref('')
const importBusy = ref(false)
const importError = ref('')
const importNotes = ref([])
function openImport() {
  importText.value = generatedSql.value || ''
  importError.value = ''
  importSource.value = 'paste'
  importOpen.value = true
}

// From SQL sources (feedback #160): paste, a Query Activity in SFMC, or a saved query.
const importSource = ref('paste') // paste | activity | saved
const pickFilter = ref('')
const activities = ref(null)
const activitiesError = ref('')
const savedQueries = ref(null)
async function setImportSource(src) {
  importSource.value = src
  pickFilter.value = ''
  if (src === 'activity' && activities.value === null) {
    activitiesError.value = ''
    if (!stack.value) { activitiesError.value = 'Not connected to Marketing Cloud.'; return }
    try { activities.value = (await listQueryActivities(stack.value, 500))?.items || [] }
    catch (e) { activitiesError.value = `Could not read the Query Activities: ${e.message}`; activities.value = null }
  }
  if (src === 'saved' && savedQueries.value === null) {
    listSavedQueryRecords().then((list) => { savedQueries.value = list })
  }
}
const pickList = computed(() => {
  const q = pickFilter.value.trim().toLowerCase()
  const list = importSource.value === 'activity'
    ? (activities.value || []).map((a) => ({ id: a.queryDefinitionId || a.key, name: a.name, sub: a.targetName ? `to ${a.targetName}` : '', sql: a.queryText || '' }))
    : (savedQueries.value || []).map((r) => ({ id: r.id, name: r.name || r.id, sub: r.source === 'builder' ? 'Query Builder' : (r.timeStamp ? new Date(r.timeStamp).toLocaleString() : ''), sql: r.queryText }))
  return list.filter((x) => !q || `${x.name} ${x.sql}`.toLowerCase().includes(q)).slice(0, 200)
})
function pickSql(x) {
  importText.value = x.sql
  importSource.value = 'paste'
}
async function runImport(sql) {
  importBusy.value = true
  importError.value = ''
  try {
    const r = await importSqlToBuilder(sql, stack.value)
    if (r.error) { importError.value = r.error; importOpen.value = true; importText.value = sql; return }
    importOpen.value = false
    importNotes.value = r.notes
    restoring = true
    layout.value = {}
    visualMode.value = true
    branches.value = r.branches.length > 1 ? r.branches : []
    setOps.value = r.branches.length > 1 ? r.ops : []
    activeBranch.value = 0
    await applyBuilderState(r.branches[0])
    // A drawn query is new work: save it.
    saveStatus.value = 'pending'
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(doAutosave, 300)
  } catch (e) {
    importError.value = e?.message || String(e)
    importOpen.value = true
  } finally {
    importBusy.value = false
  }
}

function loadRecord(id) {
  restoring = true
  getBuilderRecord(id).then((rec) => {
    if (!rec) {
      restoreNotice.value = `No saved record found for "${id}".`
      restoring = false
      return
    }
    recordId.value = id
    const bs = rec.builderState
    const deCount = bs?.selectedDEs?.length || 0
    console.log('[QueryBuilder] loadRecord', id, {
      source: rec.source,
      hasBuilderState: !!bs,
      selectedDEs: deCount,
    })
    if (!bs) {
      restoreNotice.value =
        'This query was saved before the visual builder captured its configuration. ' +
        'Rebuild it here and click Save to enable editing next time.'
      restoring = false
      return
    }
    if (!deCount) {
      restoreNotice.value = 'This saved query has no data extensions to restore.'
    }
    visualMode.value = !!bs.visualMode
    layout.value = bs.layout && typeof bs.layout === 'object' ? { ...bs.layout } : {}
    if (Array.isArray(bs.branches) && bs.branches.length > 1) {
      branches.value = bs.branches
      setOps.value = Array.isArray(bs.setOps) ? bs.setOps : []
      activeBranch.value = Math.min(bs.activeBranch || 0, bs.branches.length - 1)
    }
    // Records from before the shared model kept the visual joins in a graph of their own.
    if (!bs.layout && (bs.graphNodes?.length || bs.graphEdges?.length)) {
      const m = graphToModel(bs.selectedDEs || [], bs.graphNodes || [], bs.graphEdges || [])
      layout.value = m.layout
      if (bs.visualMode) applyBuilderState({ ...bs, selectedDEs: m.selectedDEs, joins: m.joins })
      else applyBuilderState(bs)
      return
    }
    applyBuilderState(bs)
  })
}

async function applyBuilderState(bs, attempts = 0) {
  await nextTick()
  if (selectedPanelRef.value?.loadState) {
    try {
      selectedPanelRef.value.loadState(bs)
    } catch (e) {
      console.error('[QueryBuilder] failed to restore builder state', e)
      restoreNotice.value = 'This saved query could not be fully restored (unexpected data format).'
    }
    // Let the restored state's reactive emits settle before re-enabling autosave.
    await nextTick()
    restoring = false
  } else if (attempts < 10) {
    setTimeout(() => applyBuilderState(bs, attempts + 1), 50)
  } else {
    restoring = false
  }
}

async function doAutosave() {
  if (!selectedDEs.value.length && !recordId.value) return
  saveStatus.value = 'saving'
  try {
    const id = await saveBuilderRecord({
      id: recordId.value,
      sql: generatedSql.value,
      state: {
        selectedDEs: selectedDEs.value,
        joins: joins.value,
        where: where.value,
        queryOptions: queryOptions.value,
        visualMode: visualMode.value,
        layout: layout.value,
        ...(branches.value.length > 1 ? { branches: allBranches(), setOps: setOps.value, activeBranch: activeBranch.value } : {}),
      },
    })
    if (id !== recordId.value) emit('saved', id)
    recordId.value = id
    lastSavedAt.value = Date.now()
    saveStatus.value = 'saved'
  } catch (e) {
    console.error('[QueryBuilder] autosave failed', e)
    saveStatus.value = ''
  }
}

// Debounced autosave: fires after AUTOSAVE_IDLE_MS of no changes.
watch(
  [selectedDEs, joins, where, queryOptions, generatedSql, visualMode, layout, branches, setOps, activeBranch],
  () => {
    if (restoring) return
    if (!selectedDEs.value.length && !recordId.value) return
    saveStatus.value = 'pending'
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(doAutosave, AUTOSAVE_IDLE_MS)
  },
  { deep: true }
)

const saveStatusLabel = computed(() => {
  switch (saveStatus.value) {
    case 'pending': return 'Editing…'
    case 'saving': return 'Saving…'
    case 'saved': return 'All changes saved'
    default: return ''
  }
})

async function onManualSave() {
  const wasUpdate = !!recordId.value
  clearTimeout(autosaveTimer)
  await doAutosave()
  if (saveStatus.value === 'saved') showToast(wasUpdate ? 'Query updated in Saved queries.' : 'Saved to Saved queries.')
}

function onSelectDe(node) {
  return selectedPanelRef.value?.addDe(node)
}

// "filter" on a canvas field: a new WHERE row for it, with the drawer open.
function onCanvasFilter({ alias, field }) {
  where.value = {
    ...where.value,
    conditions: [...(where.value.conditions || []), { alias, field, operator: '=', value: '', raw: false }],
  }
  showVisualExtras.value = true
}
</script>

<template>
  <div class="flex flex-col h-full bg-background">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
      <span class="text-[10px] font-bold uppercase tracking-wide bg-amber-200 text-amber-900 rounded-full px-2 py-0.5">Experimental</span>
      <HelpTip topic="overview" :topics="BUILDER_HELP" @more="helpOpen = true" />
      <span v-if="importBusy && !importOpen" class="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Drawing the query…</span>
      <span v-if="saveStatusLabel" class="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 v-if="saveStatus === 'saving'" class="h-3 w-3 animate-spin" />
        <Check v-else-if="saveStatus === 'saved'" class="h-3 w-3 text-emerald-600" />
        {{ saveStatusLabel }}
      </span>
      <div class="flex-1" />
      <slot name="actions" />
      <div v-if="!policy.disableDiagramforce" class="relative">
        <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-accent disabled:opacity-50"
          :disabled="!selectedDEs.length" title="Open this query as a diagram in Diagramforce (diagramforce.com, a free diagram editor)" @click="dfMenu = !dfMenu">
          <Share class="h-3.5 w-3.5" /> Diagramforce <ChevronDown class="h-3 w-3" />
        </button>
        <template v-if="dfMenu">
          <div class="fixed inset-0 z-40" @click="dfMenu = false" />
          <div class="absolute right-0 top-8 z-50 w-72 rounded-lg border border-border bg-card text-card-foreground shadow-xl p-1 text-xs">
            <button class="w-full text-left px-2 py-1.5 rounded hover:bg-muted" @click="toDiagramforce('model')"><b>Data model</b>, fields the query uses<br><span class="text-muted-foreground">Tables and their join lines</span></button>
            <button class="w-full text-left px-2 py-1.5 rounded hover:bg-muted" @click="toDiagramforce('model', true)"><b>Data model</b>, all fields</button>
            <button class="w-full text-left px-2 py-1.5 rounded hover:bg-muted" @click="toDiagramforce('lineage')"><b>Lineage</b><br><span class="text-muted-foreground">Which source fields feed each output column</span></button>
            <p class="px-2 pt-1 pb-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">Opens diagramforce.com in a new tab and hands it the diagram. Table and field names are sent to that page only; no data rows.</p>
          </div>
        </template>
      </div>
      <button v-if="branches.length < 2" class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-accent disabled:opacity-50"
        :disabled="!selectedDEs.length" title="Add a second SELECT, combined with UNION ALL (each SELECT gets a tab)" @click="addBranch">
        + UNION
      </button>
      <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-accent"
        title="Draw a query you paste (or the SQL panel's) as tables and joins" @click="openImport">
        <FileInput class="h-3.5 w-3.5" /> From SQL
      </button>
      <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-accent" title="What each part of the Query Builder does" @click="helpOpen = !helpOpen">
        <CircleHelp class="h-3.5 w-3.5" /> Help
      </button>
      <!-- SQL panel at the bottom: show or hide -->
        <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium"
          :class="sqlOpen ? 'border border-border hover:bg-accent' : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'"
          :disabled="!sqlOpen && !selectedDEs.length" :title="selectedDEs.length ? 'Show or hide the generated SQL at the bottom' : 'Add a data extension first'"
          @click="toggleSql">
          <EyeOff v-if="sqlOpen" class="h-3.5 w-3.5" /><Code2 v-else class="h-3.5 w-3.5" /> {{ sqlOpen ? 'Hide SQL' : 'Show SQL' }}
        </button>

        <div class="flex items-center gap-1 border border-border rounded-md p-0.5">
          <button
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
            :class="!visualMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
            @click="visualMode = false"
          ><List class="h-3 w-3" /> List</button>
          <button
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
            :class="visualMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'"
            @click="visualMode = true"
          ><LayoutGrid class="h-3 w-3" /> Visual</button>
        </div>
        <HelpTip topic="views" :topics="BUILDER_HELP" @more="helpOpen = true" />
    </div>

    <!-- One tab per SELECT of a UNION / EXCEPT / INTERSECT -->
    <div v-if="branches.length > 1" class="flex items-center gap-1 px-3 py-1 border-b border-border bg-muted/30 shrink-0 overflow-x-auto text-xs">
      <template v-for="(b, i) in branches" :key="i">
        <select v-if="i > 0" class="h-6 text-[10px] font-semibold border border-border rounded px-1 bg-background" :value="setOps[i - 1]" title="How this SELECT combines with the one before" @change="setOp(i - 1, $event.target.value)">
          <option v-for="op in SET_OPS" :key="op">{{ op }}</option>
        </select>
        <div class="flex items-center rounded-md border" :class="i === activeBranch ? 'border-primary bg-card text-primary font-semibold' : 'border-border text-muted-foreground hover:bg-card'">
          <button class="px-2 h-6" @click="switchBranch(i)">SELECT {{ i + 1 }}</button>
          <button class="pr-1.5 h-6 hover:text-destructive" title="Remove this SELECT" @click="removeBranch(i)"><X class="h-3 w-3" /></button>
        </div>
      </template>
      <button class="ml-1 h-6 px-2 rounded-md text-primary hover:bg-card" title="Add another SELECT, combined with UNION ALL" @click="addBranch">+ SELECT</button>
    </div>

    <div v-if="importNotes.length" class="flex items-start gap-2 px-3 py-1.5 bg-sky-50 dark:bg-sky-950 border-b border-sky-200 dark:border-sky-800 text-[11px] text-sky-900 dark:text-sky-100 shrink-0">
      <div class="min-w-0">
        <div class="font-semibold">Drawn from SQL. Check these:</div>
        <ul class="list-disc pl-4"><li v-for="n in importNotes" :key="n">{{ n }}</li></ul>
      </div>
      <button class="ml-auto shrink-0 hover:underline" @click="importNotes = []">Dismiss</button>
    </div>

    <!-- From SQL -->
    <div v-if="importOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="importOpen = false">
      <div class="w-full max-w-2xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl p-4 space-y-3">
        <div class="flex items-center">
          <h2 class="text-sm font-bold">Draw a query</h2>
          <button class="ml-auto text-muted-foreground hover:text-foreground" title="Close" @click="importOpen = false"><X class="h-4 w-4" /></button>
        </div>
        <p class="text-xs text-muted-foreground">
          Paste a SELECT. Its tables, joins, columns, filters and options open in the builder; expressions it cannot model are kept as written.
          Comments and formatting are not kept. <template v-if="selectedDEs.length">This replaces what is in the builder now.</template>
        </p>
        <div class="flex gap-1 text-xs">
          <button v-for="t in [['paste', 'Paste SQL'], ['activity', 'Query Activity'], ['saved', 'Saved query']]" :key="t[0]"
            class="h-7 px-2.5 rounded-md border" :class="importSource === t[0] ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border hover:bg-accent'"
            @click="setImportSource(t[0])">{{ t[1] }}</button>
        </div>
        <textarea v-if="importSource === 'paste'" v-model="importText" class="w-full h-56 rounded-md border border-border bg-background p-2 font-mono text-xs" spellcheck="false" placeholder="SELECT ... FROM ..." />
        <div v-else class="space-y-2">
          <input v-model="pickFilter" class="w-full h-8 rounded-md border border-border bg-background px-2 text-xs" :placeholder="importSource === 'activity' ? 'Filter Query Activities by name or SQL' : 'Filter saved queries by name or SQL'" />
          <p v-if="importSource === 'activity' && activitiesError" class="text-xs text-destructive">{{ activitiesError }}</p>
          <div v-else-if="importSource === 'activity' && activities === null" class="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 class="h-3 w-3 animate-spin" /> Reading Query Activities...</div>
          <div class="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
            <button v-for="x in pickList" :key="x.id" class="w-full text-left px-2 py-1.5 hover:bg-accent text-xs" :title="x.sql.slice(0, 300)" @click="pickSql(x)">
              <span class="font-medium">{{ x.name }}</span> <span class="text-muted-foreground">{{ x.sub }}</span>
              <span class="block font-mono text-[10px] text-muted-foreground truncate">{{ x.sql.replace(/\s+/g, ' ').slice(0, 140) }}</span>
            </button>
            <p v-if="!pickList.length && (importSource === 'saved' ? savedQueries !== null : activities !== null)" class="px-2 py-2 text-xs text-muted-foreground">Nothing matches.</p>
          </div>
          <p class="text-[11px] text-muted-foreground">Pick one to load its SQL here, check it, then Draw it.</p>
        </div>
        <p v-if="importError" class="text-xs text-destructive">{{ importError }}</p>
        <div class="flex justify-end gap-2">
          <button class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="importOpen = false">Cancel</button>
          <button class="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            :disabled="importBusy || !importText.trim()" @click="runImport(importText)">
            <Loader2 v-if="importBusy" class="h-3.5 w-3.5 animate-spin" /> Draw it
          </button>
        </div>
      </div>
    </div>

    <!-- Subquery editor -->
    <div v-if="subEdit" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="subEdit = null">
      <div class="w-full max-w-2xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl p-4 space-y-3">
        <div class="flex items-center">
          <h2 class="text-sm font-bold">{{ subEdit.id ? 'Edit subquery' : 'Add a subquery' }}</h2>
          <button class="ml-auto text-muted-foreground hover:text-foreground" title="Close" @click="subEdit = null"><X class="h-4 w-4" /></button>
        </div>
        <p class="text-xs text-muted-foreground">A SELECT used as a table: <code>FROM (SELECT ...) AS alias</code>. Its columns become the card's fields, so name each one.</p>
        <label class="flex items-center gap-2 text-xs">Alias
          <input v-model="subEdit.alias" class="h-7 w-40 rounded border border-border bg-background px-2 font-mono text-xs" />
        </label>
        <textarea v-model="subEdit.text" class="w-full h-48 rounded-md border border-border bg-background p-2 font-mono text-xs" spellcheck="false" placeholder="SELECT SubscriberKey, MAX(EventDate) AS LastOpen FROM _Open GROUP BY SubscriberKey" />
        <p v-if="subEdit.error" class="text-xs text-destructive">{{ subEdit.error }}</p>
        <div class="flex justify-end gap-2">
          <button class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="subEdit = null">Cancel</button>
          <button class="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50" :disabled="!subEdit.text.trim()" @click="saveSubquery">{{ subEdit.id ? 'Save' : 'Add' }}</button>
        </div>
      </div>
    </div>

    <div v-if="restoreNotice" class="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 shrink-0">
      <span>{{ restoreNotice }}</span>
      <button class="ml-auto text-amber-700 hover:underline" @click="restoreNotice = ''">Dismiss</button>
    </div>

    <div ref="stackRef" class="flex-1 flex flex-col min-h-0">
      <div v-show="sqlState !== 'max'" ref="rowRef" class="flex-1 flex min-h-0">
        <!-- Left: DE Browser -->
        <div class="w-64 shrink-0 min-h-0">
          <DEBrowser :stack="stack" @select-de="onSelectDe" />
        </div>

        <!-- Center: List or Visual -->
        <div class="relative flex-1 flex flex-col min-w-0 min-h-0 border-r border-border">
          <SelectedDEsPanel
            v-show="!visualMode"
            ref="selectedPanelRef"
            :stack="stack"
            v-model:selected="selectedDEs"
            v-model:where="where"
            v-model:queryOptions="queryOptions"
            :joins="joins"
            @update:joins="joins = $event"
          />

          <!-- Visual mode: Filters & options drawer + canvas -->
          <template v-if="visualMode">
            <div class="relative border-b border-border shrink-0">
              <button
                class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
                @click="showVisualExtras = !showVisualExtras"
              >
                <ChevronDown v-if="showVisualExtras" class="h-3.5 w-3.5" />
                <ChevronRight v-else class="h-3.5 w-3.5" />
                <SlidersHorizontal class="h-3.5 w-3.5" />
                <span>Filters &amp; options</span>
                <span
                  v-if="where.conditions.length"
                  class="ml-1 text-[9px] px-1.5 rounded-full bg-primary/15 text-primary normal-case"
                >{{ where.conditions.length }} filter{{ where.conditions.length === 1 ? '' : 's' }}</span>
              </button>
              <span class="absolute right-2 top-1.5"><HelpTip topic="filters" :topics="BUILDER_HELP" @more="helpOpen = true" /></span>
              <div v-show="showVisualExtras" class="max-h-[45vh] overflow-y-auto px-3 pb-3 space-y-3">
                <div>
                  <div class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Filters (WHERE)</div>
                  <WhereBuilder :field-options="visualFieldOptions" v-model="where" />
                </div>
                <div class="border-t border-border pt-2">
                  <div class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Output columns</div>
                  <OutputColumns :selected-d-es="selectedDEs" :query-options="queryOptions" @update:selected-d-es="selectedDEs = $event" @update:query-options="queryOptions = $event" />
                </div>
                <div class="border-t border-border pt-2">
                  <QueryOptions :field-options="visualFieldOptions" v-model="queryOptions" />
                </div>
              </div>
            </div>
            <BuilderCanvas
              :key="activeBranch"
              ref="canvasRef"
              class="flex-1 min-h-0"
              :selected-d-es="selectedDEs"
              :joins="joins"
              :layout="layout"
              :where="where"
              @update:selected-d-es="selectedDEs = $event"
              @update:joins="joins = $event"
              @update:layout="layout = $event"
              @add-de="onSelectDe"
              @add-filter="onCanvasFilter"
              @edit-subquery="openSubquery"
            >
              <template #tools>
                <span class="inline-flex items-center rounded-md border border-border bg-card px-1 h-[26px] gap-0.5" title="Help">
                  <HelpTip topic="cards" :topics="BUILDER_HELP" @more="helpOpen = true" />
                  <HelpTip topic="joins" :topics="BUILDER_HELP" @more="helpOpen = true" />
                </span>
              </template>
            </BuilderCanvas>
            <!-- First visit: how it works -->
            <div v-if="showTips" class="absolute right-4 top-16 z-30 w-80 rounded-lg border border-primary/40 bg-card text-card-foreground shadow-xl p-3 text-xs space-y-2">
              <div class="font-semibold text-sm">New here? Three steps</div>
              <ol class="list-decimal pl-4 space-y-1 text-muted-foreground">
                <li>Click or drag data extensions and data views from the left onto the canvas.</li>
                <li>Drag from the dot beside a field to a field on another card to join them; click the join's label to change it.</li>
                <li>Tick the fields you want. The SQL is at the bottom; Run query runs it.</li>
              </ol>
              <p class="text-muted-foreground">The <CircleHelp class="inline h-3 w-3" /> icons explain each part; Help lists everything.</p>
              <div class="flex justify-end gap-2">
                <button class="h-7 px-2 rounded-md border border-border hover:bg-accent" @click="helpOpen = true; closeTips()">Open help</button>
                <button class="h-7 px-2 rounded-md bg-primary text-primary-foreground" @click="closeTips">Got it</button>
              </div>
            </div>
          </template>
        </div>

      </div>

      <!-- SQL at the bottom: a bar when collapsed, resizable when open, the whole area when maximized -->
      <div v-if="selectedDEs.length || branches.length > 1"
        class="relative min-h-0 border-t border-border"
        :class="sqlState === 'max' ? 'flex-1' : 'shrink-0'"
        :style="sqlState === 'open' ? { height: sqlSize.bottom + '%' } : {}">
        <div v-if="sqlState === 'open'"
          class="absolute top-0 left-0 w-full h-1.5 -mt-0.5 z-20 cursor-row-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
          title="Drag to resize"
          @mousedown="startResize('bottom', $event)"
        />
        <SqlOutput
          v-model:sql="generatedSql"
          :selectedDEs="selectedDEs" :joins="joins" :where="where" :query-options="queryOptions"
          :visual-mode="visualMode" :layout="layout" :sql-before="sqlBefore" :sql-after="sqlAfter"
          :record-id="recordId" :state="sqlState" @state="sqlState = $event" @save="onManualSave" @apply-sql="runImport"
        />
      </div>
    </div>
    <!-- Help panel -->
    <div v-if="helpOpen" class="fixed inset-0 z-50" @click.self="helpOpen = false">
      <aside class="absolute right-0 top-0 h-full w-[420px] max-w-[95vw] border-l border-border bg-card text-card-foreground shadow-2xl overflow-y-auto p-4 space-y-3" role="dialog" aria-label="Query Builder help">
        <div class="flex items-center">
          <h2 class="text-sm font-bold">Query Builder help</h2>
          <button class="ml-auto text-muted-foreground hover:text-foreground" title="Close" @click="helpOpen = false"><X class="h-4 w-4" /></button>
        </div>
        <section v-for="id in BUILDER_HELP_ORDER" :key="id" class="space-y-0.5">
          <h3 class="text-xs font-semibold">{{ BUILDER_HELP[id].title }}</h3>
          <p class="text-xs text-muted-foreground leading-snug">{{ BUILDER_HELP[id].text }}</p>
        </section>
        <button class="text-xs text-primary hover:underline" @click="showTips = true; helpOpen = false">Show the first-visit tips again</button>
      </aside>
    </div>
  </div>
</template>
