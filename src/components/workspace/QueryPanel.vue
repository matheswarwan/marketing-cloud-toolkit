<script setup>
import { computed, ref, toRef } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import {
  Pencil, Check, X, Play, ShieldCheck, ChevronDown, LogIn, History,
  FolderOpen, RefreshCw, Search, Share2, Copy, ExternalLink, Maximize2, Minimize2, AlignLeft,
  Table2, FileOutput, Blocks, Share, Wand2, Users,
} from 'lucide-vue-next'
import { importSqlToBuilder } from '../../utils/builderImport.js'
import ShareQueryDialog from './ShareQueryDialog.vue'
import { SHARE_SETTING, shareAllowed } from '../../utils/share.js'
import { useStoredSetting } from '../../composables/useStoredSetting.js'
import { policy } from '../../utils/policy.js'
import { builderToDiagramforce, openInDiagramforce } from '../../utils/diagramforce.js'
import { useRouter } from 'vue-router'
import QueryEditor from '../detail/QueryEditor.vue'
import ValidationPanel from '../detail/ValidationPanel.vue'
import RunStepper from '../detail/RunStepper.vue'
import ResultsTable from '../detail/ResultsTable.vue'
import CleanupActions from '../detail/CleanupActions.vue'
import Button from '../ui/button/Button.vue'
import Input from '../ui/input/Input.vue'
import QueryActivityTreeNode from './QueryActivityTreeNode.vue'
import InsertFieldsMenu from './InsertFieldsMenu.vue'
import SchemaPanel from './SchemaPanel.vue'
import SaveAsActivityDialog from './SaveAsActivityDialog.vue'
import SaveResultsDialog from './SaveResultsDialog.vue'
import SharedSnippetsDialog from './SharedSnippetsDialog.vue'
import { openInSfmc } from '../../utils/sfmcLinks.js'
import { useQueryPanel } from '../../composables/useQueryPanel.js'

const props = defineProps({
  queryId:     { type: String, required: true },
  stack:       { type: String, default: null },
  canInteract: { type: Boolean, default: false },
  initialSql:  { type: String, default: '' },
  panelIndex:  { type: Number, default: 0 },
  showClose:   { type: Boolean, default: true },
  isExpanded:  { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'duplicate', 'title-change', 'expand'])
const router = useRouter()

// Share: only when turned on in Settings and allowed by policy (utils/share.js).
const shareOpen = ref(false)
const { value: shareSetting } = useStoredSetting(SHARE_SETTING, false, (v) => v === true)
const canShare = computed(() => shareAllowed(shareSetting.value))

// Open in Diagramforce: lineage of this query (tables looked up as for Open in Query Builder).
function queryToDiagramforce() {
  const diagram = importSqlToBuilder(queryText.value, props.stack).then((r) => {
    if (r.error) throw new Error(r.error)
    return builderToDiagramforce({ ...r.state, layout: {} }, { mode: 'lineage', title: queryName.value || 'Query' })
  })
  diagram.catch((e) => { formatNote.value = `Diagramforce: ${e.message}` })
  openInDiagramforce(diagram)
}

const {
  queryName, isEditingName, editableName, saveStatus, isRunning,
  resultsMode, validationResults, stepStatuses, stepErrors, stepDetails,
  elapsedSeconds, completedSummary, resultRows, resultColumns, totalRowCount,
  isFetchingMore, fetchMoreRows, fetchAllRows, LOAD_ALL_LIMIT,
  createdDeKey, createdActivityId, isDeleting,
  runs, currentRunId, activeTab, historyResults,
  sessionExpired, contactBuilderNeeded, isResultsOpen, editorHeightPct, answerPrompt,
  showRunStepper, queryText,
  onEditorChange, enableNameEditing, saveName, runValidation, runQuery,
  handleDeleteDE, handleDeleteActivity,
  onResizeStart, toggleHistoryResults, formatRunDate, openSfmcLogin,
  showQueryPicker, queryPickerLoading, queryPickerSearch, queryPickerError,
  filteredPickerItems, openQueryPicker, refreshQueryPicker, selectQueryActivity,
  relativeDate, queryPickerTree, expandedQaFolders, toggleQaFolder, queryPickerItems,
  copiedText, copyToClipboard,
  cleanQueryText, resolveTargetFields,
} = useQueryPanel({
  queryId: props.queryId,
  stack: toRef(props, 'stack'),
  panelIndex: props.panelIndex,
  initialSql: props.initialSql,
  onTitleChange: (name) => emit('title-change', { queryId: props.queryId, name }),
})

const panelTitle = computed(() => queryName.value || `Panel ${props.panelIndex + 1}`)

// Format SQL (button or Shift+Alt+F in the editor). A short note shows when it couldn't.
const editorRef = ref(null)
const formatNote = ref('')
let formatNoteTimer = null
function fixAllQuery() {
  const r = editorRef.value?.fixAll?.() || { applied: [] }
  clearTimeout(formatNoteTimer)
  formatNote.value = r.applied.length
    ? `Fixed ${r.applied.length}: ${[...new Set(r.applied.map((a) => a.label))].join('; ')}`
    : 'Nothing to fix automatically.'
  formatNoteTimer = setTimeout(() => { formatNote.value = '' }, 6000)
}
function onFormatResult(r) {
  clearTimeout(formatNoteTimer)
  formatNote.value = r.ok ? '' : (r.error || '')
  if (formatNote.value) formatNoteTimer = setTimeout(() => { formatNote.value = '' }, 4000)
}
function formatQuery() {
  editorRef.value?.format()
}

// Cmd/Ctrl+Enter in the editor runs the selection, or the whole query (feedback #75).
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
const runKey = isMac ? 'Cmd+Enter' : 'Ctrl+Enter'
function runFromKey(selection) {
  if (!props.canInteract || isRunning.value) return
  runQuery(0, selection ? { sql: selection } : {})
}

// Save as query activity (feedback #88).
const showSaveAs = ref(false)
const showSaveResults = ref(false)
const showSnippets = ref(false)
const snippetSql = ref('')
function openSnippets() {
  snippetSql.value = editorRef.value?.selectedText?.() || queryText.value
  showSnippets.value = true
}
function insertSnippet(sql) {
  showSnippets.value = false
  if (!editorRef.value?.insertText?.(sql)) onEditorChange(queryText.value ? `${queryText.value}\n${sql}` : sql)
}

// The results DE and query activity of the run on screen (feedback #91).
const currentRun = computed(() => (Array.isArray(runs.value) ? runs.value : Object.values(runs.value || {})).find((r) => r.runId === currentRunId.value) || null)
const deSearchLink = computed(() => currentRun.value?.deName ? `/data-extensions?q=${encodeURIComponent(currentRun.value.deName)}` : null)

// Results from a run whose SQL has been edited since (SQL Studio's "edited since this
// run"): greyed with a note, so stale rows are not exported by mistake. A run of a
// selection still counts as current while the selection is unchanged in the editor.
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim()
const staleResults = computed(() => {
  const ran = squash(currentRun.value?.queryText)
  return !!ran && !squash(queryText.value).includes(ran)
})

// Schema search beside the editor (feedback #72), open or closed for every panel.
const SCHEMA_KEY = 'toolkit_schemaPanel'
const schemaPanel = ref(null)
const showSchema = ref((() => { try { return localStorage.getItem(SCHEMA_KEY) === '1' } catch { return false } })())
function setSchema(on) {
  showSchema.value = on
  try { localStorage.setItem(SCHEMA_KEY, on ? '1' : '0') } catch { /* private window */ }
  if (on) schemaPanel.value?.focus?.()
}
function openSchema() {
  if (!showSchema.value) setSchema(true)
  else schemaPanel.value?.focus?.()
}
</script>

<template>
  <div class="query-panel flex flex-col min-h-0 min-w-0 rounded-lg border border-border bg-card overflow-hidden shadow-sm">
    <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
      <span class="text-[10px] font-bold text-muted-foreground">#{{ panelIndex + 1 }}</span>
      <template v-if="!isEditingName">
        <span class="text-xs font-semibold truncate flex-1" @dblclick="enableNameEditing">{{ panelTitle }}</span>
        <Button variant="ghost" size="icon" class="h-6 w-6" title="Rename panel" @click="enableNameEditing"><Pencil class="h-3 w-3" /></Button>
      </template>
      <template v-else>
        <Input v-model="editableName" class="h-6 text-xs flex-1" @keyup.enter="saveName" />
        <Button variant="ghost" size="icon" class="h-6 w-6" title="Save name" @click="saveName"><Check class="h-3 w-3" /></Button>
      </template>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!canInteract || isRunning" title="Open an existing Query Activity from Automation Studio" @click="openQueryPicker"><FolderOpen class="h-3 w-3" /></Button>
      <Button v-if="canShare" variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!queryText.trim()" title="Share query: create a link anyone can open for 24 hours (you see what is sent first)" @click="shareOpen = true"><Share2 class="h-3 w-3" /></Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!queryText.trim() || activeTab !== 'editor'" title="Format SQL (Shift+Alt+F)" @click="formatQuery"><AlignLeft class="h-3 w-3" /></Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!canInteract || activeTab !== 'editor'" title="Shared snippets: SQL your team keeps in this business unit" @click="openSnippets"><Users class="h-3 w-3" /></Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!queryText.trim() || activeTab !== 'editor'" title="Fix all: apply every one-click fix the SQL checks offer" @click="fixAllQuery"><Wand2 class="h-3 w-3" /></Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!queryText.trim()" title="Open in Query Builder: draw this query as tables and joins" @click="router.push({ path: '/queries/builder', query: { sql: queryText } })"><Blocks class="h-3 w-3" /></Button>
      <Button v-if="!policy.disableDiagramforce" variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!queryText.trim()" title="Open in Diagramforce: the query's lineage (source fields to output columns) as a diagram on diagramforce.com" @click="queryToDiagramforce"><Share class="h-3 w-3" /></Button>
      <InsertFieldsMenu :editor="editorRef" :disabled="activeTab !== 'editor' || isRunning" />
      <Button :variant="showSchema ? 'default' : 'outline'" size="sm" class="h-6 text-[10px] px-1" :disabled="activeTab !== 'editor'" :title="`Schema search: data extensions and their fields (${isMac ? 'Cmd' : 'Ctrl'}+Shift+S)`" :aria-pressed="showSchema" @click="setSchema(!showSchema)"><Table2 class="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon" class="h-6 w-6" :title="isExpanded ? 'Minimize panel' : 'Expand panel'" @click="$emit('expand')">
        <Minimize2 v-if="isExpanded" class="h-3 w-3" />
        <Maximize2 v-else class="h-3 w-3" />
      </Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!canInteract || isRunning || !queryText.trim()" title="Save as query activity: a named activity writing to a new or existing data extension" @click="showSaveAs = true"><FileOutput class="h-3 w-3" /></Button>
      <Button variant="outline" size="sm" class="h-6 text-[10px] px-1" :disabled="!canInteract || isRunning" title="Validate query" @click="runValidation"><ShieldCheck class="h-3 w-3" /></Button>
      <Button size="sm" class="h-6 text-[10px] px-1 bg-[#0176D3] text-white" :disabled="!canInteract || isRunning" :title="`Run query (${runKey}; with text selected, runs only the selection)`" @click="runQuery(0)"><Play class="h-3 w-3 fill-white" /></Button>
      <Button variant="ghost" size="icon" class="h-6 w-6" :title="activeTab === 'history' ? 'Back to editor' : 'View run history'" @click="activeTab = activeTab === 'history' ? 'editor' : 'history'"><History class="h-3 w-3" /></Button>
      <Button v-if="showClose" variant="ghost" size="icon" class="h-6 w-6" title="Close panel" @click="$emit('close')"><X class="h-3 w-3" /></Button>
    </div>

    <SharedSnippetsDialog :open="showSnippets" :stack="stack" :current-sql="snippetSql" @insert="insertSnippet" @close="showSnippets = false" />
    <SaveResultsDialog :open="showSaveResults" :stack="stack" :rows="resultRows" :total-count="totalRowCount" :sql="currentRun?.queryText || queryText" :default-name="queryName" :resolve-fields="resolveTargetFields" @close="showSaveResults = false" />
    <SaveAsActivityDialog :open="showSaveAs" :stack="stack" :sql="queryText" :default-name="queryName" :resolve-fields="resolveTargetFields" :clean-sql="cleanQueryText" @close="showSaveAs = false" />

    <!-- Query Activity picker ("Open from AS") -->
    <DialogRoot :open="showQueryPicker">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-9999 bg-black/45" @click="showQueryPicker = false" />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[70vh] rounded-xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col focus:outline-none"
          @click.stop
        >
          <DialogTitle class="sr-only">Open Query Activity</DialogTitle>

          <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div class="flex items-center gap-2">
              <FolderOpen class="h-4 w-4 text-primary" />
              <span class="text-sm font-bold text-foreground">Open Query Activity</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                class="text-[11px] border border-border text-muted-foreground px-2 py-0.5 rounded hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
                :disabled="queryPickerLoading"
                title="Refresh list"
                @click="refreshQueryPicker"
              >
                <RefreshCw class="h-3 w-3" />
              </button>
              <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground" title="Close" @click="showQueryPicker = false">
                <X class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div class="px-4 pt-3 pb-2 shrink-0">
            <div class="relative">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input v-model="queryPickerSearch" class="pl-8 h-8 text-sm" placeholder="Search by name…" autofocus />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-1 min-h-0">
            <div v-if="queryPickerLoading" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <span class="inline-block h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading query activities…
            </div>

            <div v-else-if="queryPickerError"
              class="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3 mt-1">
              {{ queryPickerError }}
            </div>

            <div v-else-if="queryPickerSearch.trim()">
              <div v-if="filteredPickerItems.length === 0" class="text-sm text-muted-foreground italic text-center py-8">
                No results match your search.
              </div>
              <button
                v-else
                v-for="item in filteredPickerItems"
                :key="item.queryDefinitionId"
                class="flex items-start justify-between gap-3 w-full text-left px-3 py-2.5 rounded-lg border border-transparent hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer bg-transparent"
                @click="selectQueryActivity(item)"
              >
                <span class="text-sm font-medium text-foreground truncate flex-1 min-w-0">{{ item.name }}</span>
                <span class="text-[10px] text-muted-foreground shrink-0 mt-0.5">{{ relativeDate(item.modifiedDate) }}</span>
              </button>
            </div>

            <!-- Folder tree (default view, no search) -->
            <div v-else-if="queryPickerTree.length === 0" class="text-sm text-muted-foreground italic text-center py-8">
              No query activities found.
            </div>
            <QueryActivityTreeNode
              v-else
              v-for="root in queryPickerTree"
              :key="root.id"
              :node="root"
              :expanded="expandedQaFolders"
              :relative-date="relativeDate"
              @toggle="toggleQaFolder"
              @select="selectQueryActivity"
            />
          </div>

          <div v-if="!queryPickerLoading && queryPickerSearch.trim() && filteredPickerItems.length > 0"
            class="px-4 py-2 border-t border-border shrink-0 text-[11px] text-muted-foreground">
            {{ filteredPickerItems.length }} {{ filteredPickerItems.length === 1 ? 'activity' : 'activities' }} matching "{{ queryPickerSearch.trim() }}"
          </div>
          <div v-else-if="!queryPickerLoading && !queryPickerSearch.trim() && queryPickerItems.length > 0"
            class="px-4 py-2 border-t border-border shrink-0 text-[11px] text-muted-foreground">
            {{ queryPickerItems.length }} {{ queryPickerItems.length === 1 ? 'activity' : 'activities' }} in {{ queryPickerTree.length }} {{ queryPickerTree.length === 1 ? 'folder' : 'folders' }}
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- Share query: confirm what leaves the browser first (utils/share.js) -->
    <ShareQueryDialog :open="shareOpen" :name="queryName || 'Untitled Query'" :sql="queryText" @close="shareOpen = false" />

    <div v-if="formatNote" class="px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-b border-border shrink-0">{{ formatNote }}</div>
    <div v-show="activeTab === 'editor'" class="flex-1 flex flex-col min-h-0">
      <div class="overflow-hidden shrink-0 flex min-w-0" :style="{ height: editorHeightPct + '%' }">
        <div class="flex-1 min-w-0 h-full">
          <QueryEditor ref="editorRef" :modelValue="queryText" :stack="stack" @update:modelValue="onEditorChange" @format="onFormatResult" @run="runFromKey" @schema-search="openSchema" />
        </div>
        <div v-if="showSchema" class="w-64 shrink-0 h-full">
          <SchemaPanel ref="schemaPanel" :editor="editorRef" :stack="stack" @close="setSchema(false)" />
        </div>
      </div>
      <div class="h-1 bg-border cursor-ns-resize shrink-0" @mousedown="onResizeStart($event)" />
      <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <ValidationPanel v-if="resultsMode === 'validating' || resultsMode === 'validation'" :results="validationResults" :isRunning="resultsMode === 'validating'" />
        <RunStepper v-else-if="showRunStepper" :stepStatuses="stepStatuses" :stepErrors="stepErrors" :stepDetails="stepDetails" :elapsedSeconds="elapsedSeconds" :completedSummary="null" :sql="queryText" @retry="runQuery" @login="openSfmcLogin" @prompt="answerPrompt" />
        <template v-else-if="resultsMode === 'results'">
          <div class="flex items-center border-b">
            <button class="flex-1 px-2 py-1 text-[10px] font-semibold flex items-center justify-between" @click="isResultsOpen = !isResultsOpen">
              <span>{{ completedSummary }}</span>
              <ChevronDown class="h-3 w-3" :class="{ 'rotate-180': isResultsOpen }" />
            </button>
            <button class="shrink-0 px-2 py-1 text-[10px] text-primary hover:underline disabled:opacity-50" :disabled="!resultRows.length || !canInteract" title="Copy these rows into an existing or a new data extension" @click="showSaveResults = true">Save to data extension</button>
          </div>
          <div v-if="currentRun && (currentRun.deName || currentRun.activityName)" class="px-2 py-1 border-b text-[10px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
            <span v-if="currentRun.deName">Results DE: <b class="text-foreground select-all">{{ currentRun.deName }}</b>
              <a v-if="currentRun.deId" :href="currentRun.deUrl" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline" @click="openInSfmc($event, currentRun.deUrl)">SFMC</a>
              <RouterLink v-if="deSearchLink" :to="deSearchLink" class="ml-1 text-primary hover:underline">Data Extensions</RouterLink>
            </span>
            <span v-if="currentRun.activityName">Query activity: <b class="text-foreground select-all">{{ currentRun.activityName }}</b>
              <a v-if="currentRun.activityId" :href="currentRun.activityUrl" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline" @click="openInSfmc($event, currentRun.activityUrl)">SFMC</a>
            </span>
          </div>
          <div v-if="staleResults" class="px-2 py-1 border-b text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40">
            The SQL was edited after this run, so these results may not match it. Run again to refresh them.
          </div>
          <div v-show="isResultsOpen" class="flex-1 overflow-auto min-h-0" :class="staleResults ? 'opacity-60' : ''">
            <ResultsTable :rows="resultRows" :columns="resultColumns" :filename="panelTitle" :sql="queryText" :totalCount="totalRowCount"
              :can-load-more="!!createdDeKey" :loading-more="isFetchingMore" :load-all-limit="LOAD_ALL_LIMIT"
              @load-more="fetchMoreRows" @load-all="fetchAllRows" />
            <CleanupActions :deKey="createdDeKey" :activityId="createdActivityId" :isDeleting="isDeleting" @delete-de="handleDeleteDE(currentRunId)" @delete-activity="handleDeleteActivity(currentRunId)" />
          </div>
        </template>
        <div v-if="sessionExpired" class="px-2 py-1 text-[10px] text-red-600 flex justify-between"><span>Session expired</span><Button size="sm" class="h-5 text-[9px]" @click="openSfmcLogin"><LogIn class="h-3 w-3" /></Button></div>
        <div v-if="contactBuilderNeeded" class="px-2 py-1 text-[10px] text-amber-700">Open Contact Builder and Automation Studio in SFMC, then press Retry</div>
        <div v-if="resultsMode === 'empty' && !sessionExpired" class="flex-1 flex items-center justify-center text-[10px] text-muted-foreground">Run to see results</div>
      </div>
    </div>

    <div v-show="activeTab === 'history'" class="flex-1 overflow-y-auto p-2 text-[10px]">
      <div v-if="!runs.length" class="text-center text-muted-foreground py-4">No runs yet</div>
      <div v-for="run in runs" :key="run.runId" class="mb-2 p-2 border rounded">
        <div class="font-semibold">{{ formatRunDate(run.runAt) }}</div>
        <button class="text-primary underline" @click="toggleHistoryResults(run)">View results</button>
        <div v-if="historyResults[run.runId]?.open && historyResults[run.runId]?.rows" class="mt-1 max-h-24 overflow-auto">
          <ResultsTable :rows="historyResults[run.runId].rows" :columns="historyResults[run.runId].columns" filename="run" :sql="run.queryText" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.query-panel { height: 100%; }
</style>
