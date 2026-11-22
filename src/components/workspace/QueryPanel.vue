<script setup>
import ReportErrorButton from '@/components/results/ReportErrorButton.vue'
import { computed, ref, toRef, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import {
  Pencil, Check, X, Play, ShieldCheck, ChevronDown, LogIn, History,
  FolderOpen, RefreshCw, Search, Share2, Copy, ExternalLink, Maximize2, Minimize2, AlignLeft,
  Table2, FileOutput, Blocks, Share, Wand2, Users, Eye, ListPlus, TextCursorInput, Save as SaveIcon, Rows3, Eraser, ArchiveRestore, TextSearch,
  Bookmark, Database, Loader2, Sparkles, AlertCircle,
} from 'lucide-vue-next'
import { referencedTables } from '../../utils/sqlContext.js'
import AiAssistDialog from './AiAssistDialog.vue'
import AiButton from '../ai/AiButton.vue'
import ToolbarMenu from './ToolbarMenu.vue'
import { useAi, pendingAiRequest } from '../../composables/useAi.js'
import { AI_STATUS_TEXT, AI_STATUS_TITLE, aiStatusToast } from '../../composables/aiBackground.js'
import { showToast } from '../../composables/useToast.js'
import SampleDialog from './SampleDialog.vue'
import EarlierTextDialog from './EarlierTextDialog.vue'
import { topPreviewSql, PREVIEW_ROWS } from '../../utils/previewSql.js'
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
const { value: shareSetting } = useStoredSetting(SHARE_SETTING, true, (v) => v !== false)
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
  queryRecord, queryName, isEditingName, editableName, saveStatus, isRunning,
  resultsMode, validationResults, stepStatuses, stepErrors, stepDetails,
  elapsedSeconds, completedSummary, resultRows, resultColumns, totalRowCount,
  isFetchingMore, fetchMoreRows, fetchAllRows, canLoadMore, LOAD_ALL_LIMIT,
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
  snapshots, takeSnapshot, restoreSnapshot, readSnapshots,
} = useQueryPanel({
  queryId: props.queryId,
  stack: toRef(props, 'stack'),
  panelIndex: props.panelIndex,
  initialSql: props.initialSql,
  onTitleChange: (name) => emit('title-change', { queryId: props.queryId, name }),
})

const panelTitle = computed(() => queryName.value || `Panel ${props.panelIndex + 1}`)
// Under the title: save state, business unit and the last run, from the panel's record.
const runList = computed(() => (Array.isArray(runs.value) ? runs.value : Object.values(runs.value || {})))
const lastRunAt = computed(() => runList.value.reduce((m, r) => Math.max(m, r?.runAt || 0), 0))
const panelMeta = computed(() => [
  saveStatus.value === 'saving' ? 'Saving…' : 'Saved',
  queryRecord.value?.businessUnit?.name || '',
  lastRunAt.value ? `last run ${formatRunDate(lastRunAt.value)}` : 'not run yet',
].filter(Boolean).join(' · '))
// The empty results area: what the query reads from, or where to start.
const readsFrom = computed(() => {
  try { return [...new Set(referencedTables(queryText.value).map((r) => r.name))].slice(0, 3) } catch { return [] }
})
// Shared look of the toolbar buttons (design: 32px pills).
const pill = 'tb-btn h-8 inline-flex items-center gap-1.5 px-2.5 rounded-full border border-border bg-card text-[13px] font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none shrink-0'
const iconPill = 'tb-icon h-8 w-8 inline-flex items-center justify-center rounded-full border border-border bg-card text-foreground/80 hover:bg-accent hover:text-foreground shrink-0'

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
const runShortcut = isMac ? '⌘↵' : 'Ctrl+↵'
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
  // A preview run keeps the editor text it came from (feedback #1028).
  const ran = squash(currentRun.value?.editorText ?? currentRun.value?.queryText)
  return !!ran && !squash(queryText.value).includes(ran)
})

// ── Feedback #1028: Run Query tools after Query Studio 2's list ──
// Preview with TOP 10: runs the query limited to its first rows.
function previewTop() {
  const sql = topPreviewSql(editorRef.value?.selectedText?.() || queryText.value)
  if (!sql) { formatNote.value = 'Preview needs a SELECT.'; return }
  runQuery(0, { sql, editorText: queryText.value, preview: true })
}
// SQL into a new panel (AI Assist, Sample); Run Query adds a panel when this one has text.
function openInNewPanel(sql) {
  showAi.value = false
  showSample.value = false
  router.push({ path: '/queries/workspace', query: { sql } })
}
// Clear, with Undo (the text is also kept under Earlier text).
const clearedText = ref('')
let clearTimer = null
async function clearQuery() {
  const text = queryText.value
  if (!text.trim()) return
  await takeSnapshot('clear', text)
  if (!editorRef.value?.replaceAll?.('')) onEditorChange('')
  clearedText.value = text
  clearTimeout(clearTimer)
  clearTimer = setTimeout(() => { clearedText.value = '' }, 20000)
}
function undoClear() {
  const text = clearedText.value
  clearedText.value = ''
  if (!editorRef.value?.replaceAll?.(text)) onEditorChange(text)
}
// Earlier text (unsaved query recovery).
const showEarlier = ref(false)
async function openEarlier() { await readSnapshots(); showEarlier.value = true }
async function restoreEarlier(snap) {
  showEarlier.value = false
  if (!snap) return
  await takeSnapshot('restore')
  if (!editorRef.value?.replaceAll?.(snap.text)) onEditorChange(snap.text)
}
// AI Assist (Chrome's built-in model; experimental, on by default, feedback #1029).
// Hidden when turned off in Settings or by an admin policy, and outside Chrome.
const ai = useAi()
const showAi = ref(false)
const aiMode = ref('write')
const aiRequest = ref('')
function openAi(mode = 'write', request = '') {
  aiMode.value = mode
  aiRequest.value = request
  showAi.value = true
}
function closeAi() { showAi.value = false; aiRequest.value = '' }
// Feedback #1032: a request hidden with Keep working (or by closing the dialog while the
// model thinks) goes on; the toolbar shows it. While one is pending, Ask AI reopens it.
const aiStatus = ref(null) // null | writing | ready | failed
function onAiStatus(s) {
  const msg = aiStatusToast(aiStatus.value, s, `panel #${props.panelIndex + 1}`)
  aiStatus.value = s
  if (msg) showToast(msg, 6000)
}
// Home's "Describe the query you need" opens a panel with this request.
watch(pendingAiRequest, (p) => {
  if (!p || p.queryId !== props.queryId || !ai.shown.value) return
  pendingAiRequest.value = null
  openAi('write', p.request)
}, { immediate: true })
// "Fix with AI" under the editor: problems from the last check or run, or the SQL checks.
const lintCount = computed(() => {
  if (!queryText.value.trim() || activeTab.value !== 'editor' || !ai.shown.value) return 0
  try { return editorRef.value?.problems?.().length || 0 } catch { return 0 }
})
const fixCount = computed(() => runProblems.value.length || lintCount.value)
const runProblems = computed(() => [
  ...(stepErrors.value || []).filter(Boolean).map(String),
  ...(validationResults.value?.fatalError ? [validationResults.value.fatalError] : []),
  ...((validationResults.value?.errors || []).map((e) => (typeof e === 'string' ? e : e?.message)).filter(Boolean)),
])
async function applyAi(sql) {
  closeAi()
  await takeSnapshot('ai')
  if (!editorRef.value?.replaceAll?.(sql)) onEditorChange(sql)
}
const showSample = ref(false)
// Opening a query activity over SQL in this panel asks first (ask before overwriting).
const pendingActivity = ref(null)
function pickActivity(item) {
  const here = queryText.value.trim()
  if (here && here !== String(item.queryText || '').trim()) { pendingActivity.value = item; return }
  selectQueryActivity(item)
}
function confirmActivity(where) {
  const item = pendingActivity.value
  pendingActivity.value = null
  if (!item) return
  if (where === 'replace') selectQueryActivity(item)
  else { showQueryPicker.value = false; openInNewPanel(item.queryText || '') }
}

// Toolbar menus (feedback #1030): what used to be about 20 icon buttons.
const insertMenu = ref(null)
const onEditor = computed(() => activeTab.value === 'editor')
const hasSql = computed(() => !!queryText.value.trim())
const editItems = computed(() => [
  { id: 'format', label: 'Format SQL', shortcut: 'Shift+Alt+F', icon: AlignLeft, disabled: !hasSql.value || !onEditor.value, run: formatQuery },
  { id: 'fixall', label: 'Fix all', desc: 'Apply every one-click fix the SQL checks offer', icon: Wand2, disabled: !hasSql.value || !onEditor.value, run: fixAllQuery },
  { id: 'find', label: 'Find and replace', shortcut: `${isMac ? 'Cmd' : 'Ctrl'}+F`, icon: TextSearch, disabled: !onEditor.value, run: () => editorRef.value?.openFind?.() },
  { id: 'fields', label: 'Insert all fields', desc: 'Every column of a table, in place of * or at the cursor', icon: ListPlus, disabled: !onEditor.value || isRunning.value, run: () => insertMenu.value?.toggle?.() },
  { id: 'clear', label: 'Clear', desc: 'Undo brings it back; also kept under Earlier text', icon: Eraser, disabled: !hasSql.value || !onEditor.value, run: clearQuery },
  { id: 'earlier', label: 'Earlier text', desc: 'This panel\'s SQL from the last 24 hours', icon: ArchiveRestore, disabled: !onEditor.value, run: openEarlier },
])
const tableItems = computed(() => [
  { id: 'schema', label: 'Schema search', desc: 'Data extensions and their fields beside the editor', shortcut: `${isMac ? 'Cmd' : 'Ctrl'}+Shift+S`, icon: Table2, checked: showSchema.value, disabled: !onEditor.value, run: () => setSchema(!showSchema.value) },
  { id: 'sample', label: 'Sample rows', desc: 'The first 10 rows of each table in the query, without running it', icon: Rows3, disabled: !props.canInteract || !hasSql.value || !onEditor.value, run: () => { showSample.value = true } },
  { id: 'snippets', label: 'Shared snippets', desc: 'SQL your team keeps in this business unit', icon: Users, disabled: !props.canInteract || !onEditor.value, run: openSnippets },
])
const openItems = computed(() => [
  { id: 'activity', label: 'Open a query activity', desc: 'From Automation Studio, into this panel', icon: FolderOpen, disabled: !props.canInteract || isRunning.value, run: openQueryPicker },
  { id: 'builder', label: 'Open in Query Builder', desc: 'Draw this query as tables and joins', icon: Blocks, disabled: !hasSql.value, run: () => router.push({ path: '/queries/builder', query: { sql: queryText.value } }) },
  { id: 'diagramforce', label: 'Open in Diagramforce', desc: 'The query\'s lineage as a diagram on diagramforce.com', icon: Share, hidden: policy.disableDiagramforce, disabled: !hasSql.value, run: queryToDiagramforce },
])
const saveItems = computed(() => [
  { id: 'saveas', label: 'Save as query activity', desc: 'A named activity writing to a new or existing data extension', icon: FileOutput, disabled: !props.canInteract || isRunning.value || !hasSql.value, run: () => { showSaveAs.value = true } },
  { id: 'share', label: 'Share', desc: 'A link anyone can open for 24 hours (you see what is sent first)', icon: Share2, hidden: !canShare.value, disabled: !hasSql.value, run: () => { shareOpen.value = true } },
])

// Schema search beside the editor (feedback #72), open or closed for every panel.
const SCHEMA_KEY = 'toolkit_schemaPanel'
// Header, search or table details and about six fields, but never more than 70% of
// the panel, so a small panel (2x2, 2x3) keeps room for the results.
const SCHEMA_MIN_HEIGHT = 'min(20rem, 70%)'
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
  <div class="query-panel flex flex-col min-h-0 min-w-0 rounded-[14px] border border-border bg-card overflow-hidden">
    <div class="query-toolbar flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
      <span class="text-xs font-bold text-muted-foreground px-[7px] py-0.5 rounded-md bg-muted shrink-0">#{{ panelIndex + 1 }}</span>
      <div class="flex flex-col min-w-[8rem] flex-1 basis-40">
        <span v-if="!isEditingName" class="flex items-center gap-1 min-w-0">
          <span class="text-sm font-semibold truncate" :title="panelTitle" @dblclick="enableNameEditing">{{ panelTitle }}</span>
          <button type="button" class="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0" :aria-label="`Rename panel ${panelIndex + 1}`" title="Rename panel" @click="enableNameEditing"><Pencil class="h-3.5 w-3.5" /></button>
        </span>
        <span v-else class="flex items-center gap-1 min-w-0">
          <Input v-model="editableName" class="h-7 text-sm flex-1 min-w-[6rem] rounded-lg" @keyup.enter="saveName" />
          <button type="button" class="p-1 rounded text-muted-foreground hover:text-foreground shrink-0" title="Save name" aria-label="Save name" @click="saveName"><Check class="h-3.5 w-3.5" /></button>
        </span>
        <span class="text-[11px] text-muted-foreground truncate" data-testid="panel-meta">{{ panelMeta }}</span>
      </div>
      <!-- Feedback #1030: the tools grouped into four labelled menus. -->
      <span class="tb-acts ml-auto flex flex-wrap items-center justify-end gap-1.5">
        <ToolbarMenu label="Edit" :icon="TextCursorInput" title="Format, fix, find, insert fields, clear, earlier text" :items="editItems" />
        <InsertFieldsMenu ref="insertMenu" bare :editor="editorRef" :disabled="activeTab !== 'editor' || isRunning" />
        <ToolbarMenu label="Tables" :icon="Table2" title="Schema search, sample rows, shared snippets" :items="tableItems" />
        <ToolbarMenu label="Open" :icon="FolderOpen" title="Open a query activity, or this query in Query Builder or Diagramforce" :items="openItems" />
        <ToolbarMenu label="Save" :icon="SaveIcon" title="Save as query activity, share" :items="saveItems" />
        <button v-if="ai.shown.value && aiStatus" type="button" data-ai-status :data-state="aiStatus" :title="AI_STATUS_TITLE[aiStatus]"
          class="tb-btn h-8 inline-flex items-center gap-1.5 px-3 rounded-full border text-[12px] font-medium shrink-0"
          :class="aiStatus === 'failed' ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
            : aiStatus === 'ready' ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-primary/40 bg-card text-primary hover:bg-primary/10 shadow-sm'"
          @click="showAi = true">
          <Loader2 v-if="aiStatus === 'writing'" class="h-3.5 w-3.5 animate-spin" />
          <AlertCircle v-else-if="aiStatus === 'failed'" class="h-3.5 w-3.5" />
          <Sparkles v-else class="h-3.5 w-3.5" />
          <span>{{ AI_STATUS_TEXT[aiStatus] }}</span>
          <span class="underline underline-offset-2">Open</span>
        </button>
        <AiButton label="Ask AI" label-class="tb-label" class="tb-btn h-8 px-2.5 rounded-full bg-card border-border text-[13px] font-medium" :disabled="activeTab !== 'editor'" title="Ask AI (experimental): write or fix this query with Gemini Nano in Chrome, on this computer" @click="openAi()" />
        <button type="button" :class="pill" :disabled="!canInteract || isRunning" title="Validate: check the query with SFMC without running it" @click="runValidation"><ShieldCheck class="h-3.5 w-3.5" /><span class="tb-label">Validate</span></button>
        <button type="button" :class="pill" :disabled="!canInteract || isRunning || !queryText.trim()" :title="`Preview: run with TOP ${PREVIEW_ROWS} (the selection, or the whole query) to see the first rows quickly`" @click="previewTop"><Eye class="h-3.5 w-3.5" /><span class="tb-label">Preview</span></button>
        <button type="button" class="tb-btn h-8 inline-flex items-center gap-1.5 px-3.5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none shrink-0" :disabled="!canInteract || isRunning" :title="`Run query (${runKey}; with text selected, runs only the selection)`" @click="runQuery(0)">
          <Play class="h-3 w-3 fill-current" /><span class="tb-label">Run</span><kbd class="tb-label font-sans text-[10px] opacity-85">{{ runShortcut }}</kbd>
        </button>
        <button type="button" :class="[iconPill, activeTab === 'history' ? 'bg-accent' : '']" :aria-pressed="activeTab === 'history'" :title="activeTab === 'history' ? 'Back to editor' : 'Run history'" @click="activeTab = activeTab === 'history' ? 'editor' : 'history'"><History class="h-4 w-4" /></button>
        <button type="button" :class="iconPill" :title="isExpanded ? 'Leave full screen (Esc)' : 'Full screen'" :aria-label="isExpanded ? 'Leave full screen' : 'Full screen'" :aria-pressed="isExpanded" @click="$emit('expand')">
          <Minimize2 v-if="isExpanded" class="h-4 w-4" />
          <Maximize2 v-else class="h-4 w-4" />
        </button>
        <button v-if="showClose" type="button" :class="iconPill" title="Close panel" @click="$emit('close')"><X class="h-4 w-4" /></button>
      </span>
    </div>

    <AiAssistDialog v-if="ai.shown.value" :open="showAi" :sql="queryText" :editor="editorRef" :run-problems="runProblems" :initial-mode="aiMode" :initial-request="aiRequest" :auto-ask="!!aiRequest" can-background @status="onAiStatus" @close="closeAi" @apply="applyAi" @new-panel="openInNewPanel" />
    <SampleDialog :open="showSample" :stack="stack" :editor="editorRef" @close="showSample = false" @new-panel="openInNewPanel" />
    <EarlierTextDialog :open="showEarlier" :snapshots="snapshots" :current="queryText" @close="showEarlier = false" @restore="restoreEarlier" />
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

          <div v-if="pendingActivity" class="mx-4 mb-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-2 text-xs space-y-2" role="alertdialog" aria-label="Replace the SQL in this panel?">
            <p>This panel already has SQL. Replace it with <b>{{ pendingActivity.name }}</b>? The current text is kept under Earlier text.</p>
            <div class="flex gap-2">
              <Button size="sm" class="h-7 text-xs" @click="confirmActivity('replace')">Replace</Button>
              <Button variant="outline" size="sm" class="h-7 text-xs" @click="confirmActivity('new')">Open in a new panel</Button>
              <Button variant="ghost" size="sm" class="h-7 text-xs" @click="pendingActivity = null">Cancel</Button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-1 min-h-0">
            <div v-if="queryPickerLoading" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <span class="inline-block h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading query activities…
            </div>

            <div v-else-if="queryPickerError"
              class="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3 mt-1">
              {{ queryPickerError }}<ReportErrorButton />
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
                @click="pickActivity(item)"
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
              @select="pickActivity"
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

    <div v-if="clearedText" class="px-3 py-1.5 text-xs flex items-center gap-2 bg-muted border-b border-border shrink-0">Cleared. <button class="text-primary hover:underline font-medium" @click="undoClear">Undo</button><button class="ml-auto text-muted-foreground hover:text-foreground" title="Dismiss" @click="clearedText = ''"><X class="h-3.5 w-3.5" /></button></div>
    <div v-if="formatNote" class="px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-b border-border shrink-0">{{ formatNote }}</div>
    <div v-show="activeTab === 'editor'" class="flex-1 flex flex-col min-h-0">
      <!-- With the schema search open the row is at least SCHEMA_MIN_HEIGHT tall: at the
           default 25% it showed one field before scrolling (live test, 2026-11-07). -->
      <div class="overflow-hidden shrink-0 flex min-w-0" :style="{ height: editorHeightPct + '%', minHeight: showSchema ? SCHEMA_MIN_HEIGHT : null }" data-editor-row>
        <div class="flex-1 min-w-0 h-full">
          <QueryEditor ref="editorRef" :modelValue="queryText" :stack="stack" @update:modelValue="onEditorChange" @format="onFormatResult" @run="runFromKey" @schema-search="openSchema" />
        </div>
        <div v-if="showSchema" class="w-64 shrink-0 h-full border-l border-border">
          <SchemaPanel ref="schemaPanel" :editor="editorRef" :stack="stack" @close="setSchema(false)" />
        </div>
      </div>
      <div class="h-1.5 bg-border/70 hover:bg-primary/50 cursor-ns-resize shrink-0 transition-colors" title="Drag to resize" @mousedown="onResizeStart($event)" />
      <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div v-if="ai.shown.value && fixCount && activeTab === 'editor'" class="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs bg-muted/50 shrink-0">
          <span class="text-muted-foreground flex-1">{{ fixCount === 1 ? '1 problem' : `${fixCount} problems` }} found by {{ runProblems.length ? 'the last check or run' : 'the SQL checks' }}.</span>
          <AiButton size="sm" label="Fix with AI" title="Fix with AI (experimental): Gemini Nano in Chrome suggests a fixed query; you see the changes before applying them" @click="openAi('fix')" />
        </div>
        <ValidationPanel v-if="resultsMode === 'validating' || resultsMode === 'validation'" :results="validationResults" :isRunning="resultsMode === 'validating'" :sql="queryText" />
        <RunStepper v-else-if="showRunStepper" :stepStatuses="stepStatuses" :stepErrors="stepErrors" :stepDetails="stepDetails" :elapsedSeconds="elapsedSeconds" :completedSummary="null" :sql="queryText" @retry="runQuery" @login="openSfmcLogin" @prompt="answerPrompt" />
        <template v-else-if="resultsMode === 'results'">
          <div class="flex items-center gap-2 border-b border-border px-1">
            <button class="flex-1 min-w-0 px-2 py-1.5 text-xs font-semibold text-foreground flex items-center justify-between gap-2" :aria-expanded="isResultsOpen" @click="isResultsOpen = !isResultsOpen">
              <span class="truncate">{{ completedSummary }}</span>
              <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" :class="{ 'rotate-180': isResultsOpen }" />
            </button>
            <button class="shrink-0 h-7 inline-flex items-center gap-1 px-2.5 rounded-full border border-border bg-card text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none" :disabled="!resultRows.length || !canInteract" title="Copy these rows into an existing or a new data extension" @click="showSaveResults = true"><Database class="h-3.5 w-3.5" /> Save to data extension</button>
          </div>
          <div v-if="currentRun && (currentRun.deName || currentRun.activityName)" class="px-3 py-1.5 border-b border-border text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
            <span v-if="currentRun.deName">Results DE: <b class="text-foreground font-mono font-medium select-all">{{ currentRun.deName }}</b>
              <a v-if="currentRun.deId" :href="currentRun.deUrl" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline" @click="openInSfmc($event, currentRun.deUrl)">SFMC</a>
              <RouterLink v-if="deSearchLink" :to="deSearchLink" class="ml-1 text-primary hover:underline">Data Extensions</RouterLink>
            </span>
            <span v-if="currentRun.activityName">Query activity: <b class="text-foreground font-mono font-medium select-all">{{ currentRun.activityName }}</b>
              <a v-if="currentRun.activityId" :href="currentRun.activityUrl" target="_blank" rel="noopener" class="ml-1 text-primary hover:underline" @click="openInSfmc($event, currentRun.activityUrl)">SFMC</a>
            </span>
          </div>
          <div v-if="currentRun?.preview" class="px-3 py-1.5 border-b border-border text-[11px] text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40">Preview: the first {{ PREVIEW_ROWS }} rows only (the query ran with TOP {{ PREVIEW_ROWS }}). Run it to get every row.</div>
          <div v-if="staleResults" class="px-3 py-1.5 border-b border-border text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40">
            The SQL was edited after this run, so these results may not match it. Run again to refresh them.
          </div>
          <div v-show="isResultsOpen" class="flex-1 overflow-auto min-h-0" :class="staleResults ? 'opacity-60' : ''">
            <ResultsTable :rows="resultRows" :columns="resultColumns" :filename="panelTitle" :sql="queryText" :totalCount="totalRowCount"
              :can-load-more="canLoadMore" :loading-more="isFetchingMore" :load-all-limit="LOAD_ALL_LIMIT"
              @load-more="fetchMoreRows" @load-all="fetchAllRows" />
            <CleanupActions :deKey="createdDeKey" :activityId="createdActivityId" :isDeleting="isDeleting" @delete-de="handleDeleteDE(currentRunId)" @delete-activity="handleDeleteActivity(currentRunId)" />
          </div>
        </template>
        <div v-if="sessionExpired" class="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-2"><span>Session expired</span><button type="button" class="h-7 inline-flex items-center gap-1 px-2.5 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90" @click="openSfmcLogin"><LogIn class="h-3.5 w-3.5" /> Log in</button></div>
        <div v-if="contactBuilderNeeded" class="px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">Open Contact Builder and Automation Studio in SFMC, then press Retry</div>
        <div v-if="resultsMode === 'empty' && !sessionExpired" class="flex-1 min-h-0 overflow-y-auto">
          <!-- Ready to run: the tables the query reads from (design). -->
          <div v-if="hasSql" class="min-h-full flex flex-col items-center justify-center gap-2.5 p-6 text-center">
            <span class="h-11 w-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Play class="h-5 w-5" /></span>
            <span class="text-[15px] font-semibold">Ready to run</span>
            <span class="text-[13px] text-muted-foreground max-w-[340px]">
              <template v-if="readsFrom.length">Reads from <template v-for="(t, i) in readsFrom" :key="t"><code class="font-mono text-xs text-foreground break-all">{{ t }}</code>{{ i < readsFrom.length - 1 ? ', ' : '' }}</template>. </template>Results appear here with the row count and downloads.
            </span>
            <button type="button" class="h-9 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none" :disabled="!canInteract || isRunning" @click="runQuery(0)"><Play class="h-3.5 w-3.5 fill-current" /> Run query</button>
          </div>
          <!-- Empty editor: ways to start (design "Start from"). -->
          <div v-else class="p-4 sm:p-5 flex flex-col gap-2.5">
            <span class="text-[13px] font-semibold text-foreground/80">Start from</span>
            <RouterLink to="/queries/saved" class="start-card">
              <span class="start-icon bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"><Bookmark class="h-4 w-4" /></span>
              <span class="flex flex-col min-w-0"><span class="text-sm font-semibold">A saved query</span><span class="text-xs text-muted-foreground">Open one from Saved queries</span></span>
            </RouterLink>
            <button type="button" class="start-card text-left disabled:opacity-50" :disabled="!canInteract || isRunning" @click="openQueryPicker">
              <span class="start-icon bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"><FolderOpen class="h-4 w-4" /></span>
              <span class="flex flex-col min-w-0"><span class="text-sm font-semibold">A query activity</span><span class="text-xs text-muted-foreground">From Automation Studio, into this panel</span></span>
            </button>
            <RouterLink to="/queries/builder" class="start-card">
              <span class="start-icon bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"><Blocks class="h-4 w-4" /></span>
              <span class="flex flex-col min-w-0"><span class="text-sm font-semibold">Build it visually</span><span class="text-xs text-muted-foreground">Pick data extensions and fields in Query Builder</span></span>
            </RouterLink>
            <button type="button" class="start-card text-left disabled:opacity-50" :disabled="isRunning" @click="insertMenu?.toggle?.()">
              <span class="start-icon bg-primary/10 text-primary"><Database class="h-4 w-4" /></span>
              <span class="flex flex-col min-w-0"><span class="text-sm font-semibold">A data extension</span><span class="text-xs text-muted-foreground">Every field of a data extension or data view, as a SELECT</span></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'history'" class="flex-1 overflow-y-auto p-3 text-xs flex flex-col gap-2">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Run history</div>
      <div v-if="!runs.length" class="text-center text-muted-foreground py-6">No runs yet</div>
      <div v-for="run in runs" :key="run.runId" class="p-3 border border-border rounded-xl bg-card">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold">{{ formatRunDate(run.runAt) }}</span>
          <span v-if="run.direct" class="text-muted-foreground mr-auto ml-2 truncate" :title="`Read directly from ${run.direct.deName}, no Query Activity. View results reads its rows as they are now.`">Read directly from {{ run.direct.deName }}</span>
          <span v-if="!run.deKey && !run.direct" class="text-muted-foreground" :title="run.cleanedAt ? `Its data extension and Query Activity were deleted from SFMC ${formatRunDate(run.cleanedAt)} (Settings > Running queries)` : 'Its data extension was deleted from SFMC'">{{ run.cleanedAt ? 'Cleaned up from SFMC' : 'Results deleted' }}</span>
          <button v-else class="text-primary hover:underline font-medium" @click="toggleHistoryResults(run)">{{ historyResults[run.runId]?.open ? 'Hide results' : 'View results' }}</button>
        </div>
        <div v-if="historyResults[run.runId]?.open && historyResults[run.runId]?.rows" class="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
          <ResultsTable :rows="historyResults[run.runId].rows" :columns="historyResults[run.runId].columns" filename="run" :sql="run.queryText" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.query-panel { height: 100%; }
.start-card { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 12px; color: hsl(var(--foreground)); text-decoration: none; background: hsl(var(--card)); transition: background-color .15s; }
.start-card:hover { background: hsl(var(--accent)); }
.start-icon { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
</style>

<style>
/* Feedback #1030: labels on the toolbar, dropped when the panel is narrow. */
.query-panel { container-type: inline-size; }
@container (max-width: 760px) { .query-toolbar .tb-label { display: none; } }
/* Narrow panels (2x3): smaller pills, no menu arrows, so the tools fit in fewer rows. */
@container (max-width: 520px) {
  .query-toolbar .tb-chev { display: none; }
  .query-toolbar .tb-btn { height: 28px; padding-left: 8px; padding-right: 8px; }
  .query-toolbar .tb-icon { height: 28px; width: 28px; }
  .query-toolbar .tb-acts { gap: 4px; }
}
</style>
