import { ref, computed, watch, onMounted, onUnmounted, unref } from 'vue'
import { extractDataExtensions, extractSelectColumns, inferSelectColumnDetails } from '../utils/sqlParser.js'
import { planUnderscoreRenames, wrapWithRenamedColumns } from '../utils/columnNames.js'
import { DATA_VIEW_FIELDS, isSkippableDE } from '../utils/dataViews.js'
import { bareTableName } from '../utils/schemaCatalog.js'
import { openTab } from '../utils/openTab.js'
import { useStoredSetting } from './useStoredSetting.js'
import { SNAPSHOTS_KEY, addSnapshot, pruneSnapshots, typingSnapshotDue } from '../utils/textSnapshots.js'
import { HISTORY_SETTING, historyAllowed, runsForStorage } from '../utils/history.js'
import { isAutoName, suggestQueryName } from '../utils/queryNames.js'
import { directReadPlan, readDirect, projectRow } from '../utils/directRead.js'
import { addOffsetToOrderBy } from '../utils/sqlLint.js'
import { showToast } from './useToast.js'
import { choiceForRun, noteChoice, changeNotice } from '../utils/runQueryStart.js'
import {
  fetchDEMetadata, fetchDEFields, buildDEFields,
  createTargetDE, createQueryActivity,
  startQueryActivity, getQueryActivityStatus, fetchDERows,
  deleteDE, deleteQueryActivity, getOrCreateDEFolder, getOrCreateQAFolder,
  getAnyQueryActivityId, validateQueryText, listQueryActivities, listQAFolders, searchLocalDEsByName,
  DEFAULT_TEXT_LENGTH, fetchCurrentBU, insertDERowsAsync, sfmcFetch,
  parseRetentionDays, createRunAutomation, runAutomationOnce, fetchLatestAutomationRun, deleteAutomation,
} from '../utils/sfmcApi.js'
import {
  runNames, isNameClash, markerField, markerRow, resultRows as toResultRows, resultColumns as toResultColumns,
  waitForRun, waitForAutomationRun, formatRunTime, RunFailedError,
} from '../utils/queryRun.js'
import { coreOrigin } from '../utils/sfmcHosts.js'

export function useQueryPanel(options) {
  // Query history: a run's SQL is stored only while history is on (utils/history.js).
  const { value: keepHistory } = useStoredSetting(HISTORY_SETTING, true, (v) => v !== false)
  const { queryId, stack: stackInput, initialSql = '', onTitleChange } = options
  const stack = computed(() => unref(stackInput))
  const canInteract = computed(() => !!stack.value)

  // SFMC calls of the current run: every API call of a run goes through runFetch
  // (live test, 2026-11-07: the page-wide count included runs in other panels).
  let runCalls = 0
  const runFetch = (url, method, body) => { runCalls++; return sfmcFetch(url, method, body) }

  // ── Core state ────────────────────────────────────────────
  const queryRecord = ref(null)
  const queryText   = ref('')
  const queryName   = ref('')

  watch(queryName, (name) => { if (onTitleChange) onTitleChange(name) })

  // ── Connection ────────────────────────────────────────────
  // ── Auto-save ─────────────────────────────────────────────
  const saveStatus = ref('saved')
  let   saveTimer  = null

  // ── Name editing ──────────────────────────────────────────
  const isEditingName = ref(false)
  const editableName  = ref('')

  // ── Results zone ──────────────────────────────────────────
  const resultsMode       = ref('empty')
  const validationResults = ref(null)

  // ── Run state ─────────────────────────────────────────────
  const isRunning        = ref(false)
  const stepStatuses     = ref(Array(5).fill('pending'))
  const stepErrors       = ref(Array(5).fill(null))
  const stepDetails      = ref(Array(5).fill(null))
  const elapsedSeconds   = ref(0)
  const completedSummary = ref(null)
  let   elapsedTimer     = null
  // SQL the Query Activity runs when output columns had to be renamed (see Step 1).
  let   activitySql      = null

  const resultRows      = ref([])
  const resultColumns   = ref([])
  // Field names of the target DE this run created: the result's column names (SFMC's
  // rowset gives them in lower case, live test, 2026-11-07), also when a run returns no
  // rows (feedback #31).
  let targetFieldNames = []
  // The target DE has the run marker column (utils/queryRun.js), and its fields.
  let targetHasMarker = false
  let targetFields = []
  const totalRowCount   = ref(0)
  const isFetchingMore  = ref(false)

  const createdDeKey      = ref(null)
  const createdDeId       = ref(null)
  const createdDeName     = ref(null)
  const createdActivityId = ref(null)
  const isDeleting    = ref({ de: false, activity: false })
  const deleteError   = ref(null)
  const deleteConfirm = ref(null)

  // ── Run history ───────────────────────────────────────────
  const runs                = ref([])
  const currentRunId        = ref(null)
  const copiedText          = ref(null)
  const createdActivityName = ref(null)
  const activeTab           = ref('editor')
  const queryViewOpen       = ref(null)

  function toggleQueryView(runId) {
    queryViewOpen.value = queryViewOpen.value === runId ? null : runId
  }

  // ── History results (per-run "View Results") ──────────────
  // historyResults[runId] = { rows, columns, loading, error, open }
  const historyResults = ref({})

  async function toggleHistoryResults(run) {
    const id = run.runId
    const cur = historyResults.value[id]

    // If already open → close
    if (cur?.open) {
      historyResults.value = { ...historyResults.value, [id]: { ...cur, open: false } }
      return
    }

    // If we already have rows → just reopen
    if (cur?.rows) {
      historyResults.value = { ...historyResults.value, [id]: { ...cur, open: true } }
      return
    }

    // Fetch for the first time
    historyResults.value = {
      ...historyResults.value,
      [id]: { rows: null, columns: [], loading: true, error: null, open: true },
    }
    try {
      const runStack = run.stack || stack.value
      // A direct read (feedback #1076) reads its DE again: its rows as they are now.
      const d = run.direct
      const data = await fetchDERows(runStack, d ? d.deKey : run.deKey, 1, d?.top != null ? Math.min(2500, Math.max(d.top, 1)) : 2500)
      const items = data.items || []
      const rows = d
        ? items.map((item) => projectRow(item, d.columns)).slice(0, d.top ?? Infinity)
        : toResultRows(items, run.fields).rows
      const columns = d ? d.columns : toResultColumns(run.fields, rows)
      historyResults.value = {
        ...historyResults.value,
        [id]: { rows, columns, loading: false, error: null, open: true },
      }
    } catch (e) {
      historyResults.value = {
        ...historyResults.value,
        [id]: { rows: null, columns: [], loading: false, error: e.message, open: true },
      }
    }
  }

  const sessionExpired         = ref(false)
  const contactBuilderNeeded   = ref(false) // shown when contactsmeta tab auto-open + retry both fail
  const isRunDetailsOpen = ref(false)
  const isResultsOpen    = ref(true)

  // ── Resize handle ─────────────────────────────────────────
  const editorHeightPct = ref(25)
  let   isResizing      = false

  // ── Poll abort flag ────────────────────────────────────────
  let pollAborted = false

  const PAGE_SIZE = 2500

  // The last run read its DE directly (feedback #1076): { key, columns, top }. More rows
  // come from that DE, in the query's columns, up to its TOP. Never deleted by the panel.
  let direct = null
  // Reactive copy for the template: Load more / Load all work for direct reads too.
  const directKey = ref(null)
  const canLoadMore = computed(() => !!(directKey.value || createdDeKey.value))
  const rowsKey = () => direct?.key || createdDeKey.value
  const flatten = (items) => (direct ? items.map((item) => projectRow(item, direct.columns)) : toResultRows(items, targetFieldNames).rows)
  const capTotal = (n) => (direct?.top != null ? Math.min(direct.top, n) : n)
  const addRows = (flat, count) => {
    const all = [...resultRows.value, ...flat]
    totalRowCount.value = capTotal(count ?? all.length)
    resultRows.value = all.slice(0, Math.max(totalRowCount.value, 0))
  }

  async function fetchMoreRows() {
    if (isFetchingMore.value || !rowsKey()) return
    isFetchingMore.value = true
    try {
      const nextPage = Math.floor(resultRows.value.length / PAGE_SIZE) + 1
      const gen = rowsGen
      const data = await fetchDERows(stack.value, rowsKey(), nextPage, PAGE_SIZE)
      if (gen === rowsGen) addRows(flatten(data.items || []), data.count)
    } finally {
      isFetchingMore.value = false
    }
  }

  // Up to LOAD_ALL_LIMIT rows: more would make the page slow; for bigger results,
  // export the target DE in SFMC.
  const LOAD_ALL_LIMIT = 50000

  // Bumped by every run, so rows still loading for an earlier run are dropped.
  let rowsGen = 0

  let fetchingGen = -1

  async function fetchAllRows() {
    // A load still running for an earlier run does not block this run's.
    if (!rowsKey() || (isFetchingMore.value && fetchingGen === rowsGen)) return
    isFetchingMore.value = true
    const gen = fetchingGen = rowsGen
    try {
      let page = Math.floor(resultRows.value.length / PAGE_SIZE) + 1
      while (resultRows.value.length < LOAD_ALL_LIMIT) {
        const data = await fetchDERows(stack.value, rowsKey(), page, PAGE_SIZE)
        if (gen !== rowsGen || pollAborted) break
        const items = data.items || []
        if (!items.length) break
        addRows(flatten(items), data.count)
        if (resultRows.value.length >= totalRowCount.value) break
        page++
      }
    } finally {
      if (fetchingGen === gen) isFetchingMore.value = false
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────

  onUnmounted(() => {
    pollAborted = true
    if (promptResolver) promptResolver(false)
    flushSave() // a pending save is written, not dropped (feedback #1028)
    window.removeEventListener('pagehide', flushSave)
    clearInterval(elapsedTimer)
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  })

  // ── Auto-save ─────────────────────────────────────────────
  let pendingText = null
  function writeText(text) {
    const updated = { ...queryRecord.value, queryText: text }
    // Feedback #1053: a panel the user has not named takes its name from the SQL.
    if (isAutoName(updated)) {
      updated.name = suggestQueryName(text)
      updated.autoName = true
      queryName.value = updated.name
    }
    queryRecord.value = updated
    const saved = new Promise((resolve) => chrome.storage.local.set({ [queryId]: updated }, resolve))
    tagBusinessUnit()
    return saved
  }
  function onEditorChange(newText) {
    queryText.value  = newText
    saveStatus.value = 'saving'
    pendingText = newText
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      pendingText = null
      await writeText(newText)
      saveStatus.value = 'saved'
      if (typingSnapshotDue(snapshots.value, newText)) takeSnapshot('typing', newText)
    }, 500)
  }
  // Closing the panel or the tab within the save delay still saves the text.
  function flushSave() {
    clearTimeout(saveTimer)
    if (pendingText == null) return
    const text = pendingText
    pendingText = null
    try { writeText(text) } catch { /* extension context gone */ }
  }
  try { window.addEventListener('pagehide', flushSave) } catch { /* no window */ }

  // Runs changed outside this panel (Delete old runs from SFMC, feedback #1081) are taken
  // in, so the next autosave does not write the deleted ids back.
  function onStorageChanged(changes, area) {
    const next = area === 'local' && changes[queryId]?.newValue
    if (!next || !Array.isArray(next.runs) || !queryRecord.value) return
    if (JSON.stringify(next.runs) === JSON.stringify(queryRecord.value.runs || [])) return
    queryRecord.value = { ...queryRecord.value, runs: next.runs }
    runs.value = next.runs
    if (isRunning.value) return // a run in progress keeps its own ids
    if (!next.runs.some((r) => r.runId === currentRunId.value && r.deId)) { createdDeId.value = null; createdDeKey.value = null }
    if (!next.runs.some((r) => r.runId === currentRunId.value && r.activityId)) createdActivityId.value = null
  }
  try { chrome.storage.onChanged.addListener(onStorageChanged) } catch { /* no extension context */ }
  onUnmounted(() => { try { chrome.storage.onChanged.removeListener(onStorageChanged) } catch { /* gone */ } })

  // ── Earlier text (feedback #1028) ─────────────────────────
  // Copies of this panel's SQL from the last 24 hours (utils/textSnapshots.js).
  const snapshots = ref([])
  function readSnapshots() {
    return new Promise((resolve) => chrome.storage.local.get(SNAPSHOTS_KEY, (r) => {
      const all = r?.[SNAPSHOTS_KEY] || {}
      snapshots.value = pruneSnapshots(all[queryId])
      resolve(all)
    }))
  }
  async function takeSnapshot(reason, text = queryText.value) {
    try {
      const all = await readSnapshots()
      const list = addSnapshot(all[queryId], text, reason)
      snapshots.value = list
      // Old copies of every panel are dropped on the way.
      const next = {}
      for (const [k, v] of Object.entries(all)) { const kept = pruneSnapshots(v); if (kept.length) next[k] = kept }
      if (list.length) next[queryId] = list
      else delete next[queryId]
      await new Promise((resolve) => chrome.storage.local.set({ [SNAPSHOTS_KEY]: next }, resolve))
    } catch { /* not in an extension */ }
  }
  /** Puts an earlier text back; the text it replaces is kept as a copy first. */
  async function restoreSnapshot(snap) {
    await takeSnapshot('restore')
    onEditorChange(snap.text)
  }

  // ── Name editing ──────────────────────────────────────────
  function enableNameEditing() {
    editableName.value  = queryName.value
    isEditingName.value = true
  }

  async function saveName() {
    isEditingName.value = false
    const trimmed = editableName.value.trim()
    if (!trimmed) return
    queryName.value = trimmed
    const updated = { ...queryRecord.value, name: trimmed, autoName: false }
    queryRecord.value = updated
    await new Promise((resolve) => chrome.storage.local.set({ [queryId]: updated }, resolve))
    chrome.runtime.sendMessage({ type: 'RENAME_QUERY', name: trimmed, id: queryId })
  }

  // ── Validate ──────────────────────────────────────────────
  async function runValidation() {
    if (!queryText.value.trim()) return
    resultsMode.value       = 'validating'
    validationResults.value = null

    try {
      const qaId   = await getAnyQueryActivityId(stack.value)
      const result = await validateQueryText(stack.value, qaId, cleanQueryText(queryText.value))
      validationResults.value = { queryValid: result.queryValid, errors: result.errors ?? [], warnings: result.warnings ?? [] }
    } catch (err) {
      if (err.message?.includes('SESSION_EXPIRED')) {
        sessionExpired.value = true
        resultsMode.value = 'empty'
        return
      } else if (err.message === 'NO_ACTIVITIES') {
        validationResults.value = { noActivities: true }
      } else {
        validationResults.value = { fatalError: err.message }
      }
    }
    resultsMode.value = 'validation'
  }

  // ── Reuse setting ─────────────────────────────────────────
  // Off by default: every run gets a fresh DE + Query Activity. When enabled in
  // settings, re-running an identical query silently reuses the last one instead —
  // opting into the setting is the confirmation, so no per-run prompt.
  function isReuseEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get('_reuseQueryDE', (res) => resolve(res._reuseQueryDE === true))
    })
  }

  // Days a row stays in a new target DE (0 = keep forever). Settings > Running queries.
  function retentionDays() {
    return new Promise((resolve) => {
      chrome.storage.local.get('_queryDERetentionDays', (res) => resolve(parseRetentionDays(res._queryDERetentionDays)))
    })
  }

  // ── Query Activity picker ("Open from AS") ────────────────
  // Browse/search existing Query Activities in Automation Studio and load one's
  // SQL into this panel's editor.
  const showQueryPicker    = ref(false)
  const queryPickerLoading = ref(false)
  const queryPickerItems   = ref([])
  const queryPickerFolders = ref([])
  const queryPickerSearch  = ref('')
  const queryPickerError   = ref('')
  const expandedQaFolders  = ref(new Set())

  function relativeDate(dateStr) {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 2)   return 'just now'
    if (mins < 60)  return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)   return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 30)  return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  // Builds a folder tree from the two already-fetched flat lists — no extra API
  // calls needed since listQAFolders returns every QA folder in one shot (unlike
  // the DE folder tree, which loads children lazily per-folder).
  const UNCATEGORIZED_ID = '__qa_uncategorized__'
  const queryPickerTree = computed(() => {
    const folders = queryPickerFolders.value
    const nodeMap  = new Map()
    for (const f of folders) {
      nodeMap.set(f.categoryId, { id: f.categoryId, name: f.name, parentId: f.parentId, activities: [], children: [] })
    }
    const orphanActivities = []
    for (const item of queryPickerItems.value) {
      const node = nodeMap.get(item.categoryId)
      if (node) node.activities.push(item)
      else orphanActivities.push(item)
    }
    const roots = []
    for (const node of nodeMap.values()) {
      const parent = node.parentId != null ? nodeMap.get(node.parentId) : null
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    if (orphanActivities.length) {
      roots.push({ id: UNCATEGORIZED_ID, name: 'Uncategorized', parentId: null, activities: orphanActivities, children: [] })
    }
    return roots
  })

  function toggleQaFolder(node) {
    const key = String(node.id)
    if (expandedQaFolders.value.has(key)) expandedQaFolders.value.delete(key)
    else expandedQaFolders.value.add(key)
    expandedQaFolders.value = new Set(expandedQaFolders.value)
  }

  async function openQueryPicker() {
    showQueryPicker.value   = true
    queryPickerSearch.value = ''
    queryPickerError.value  = ''
    if (queryPickerItems.value.length) return
    queryPickerLoading.value = true
    try {
      const [activityData, folderData] = await Promise.all([
        listQueryActivities(stack.value),
        listQAFolders(stack.value).catch(() => ({ items: [] })), // folders are a nice-to-have; don't fail the whole picker if this errors
      ])
      queryPickerItems.value   = activityData.items || []
      queryPickerFolders.value = folderData.items || []
    } catch (e) {
      queryPickerError.value = e.message || 'Failed to load query activities.'
    } finally {
      queryPickerLoading.value = false
    }
  }

  function refreshQueryPicker() {
    queryPickerItems.value   = []
    queryPickerFolders.value = []
    openQueryPicker()
  }

  async function selectQueryActivity(item) {
    await takeSnapshot('open')
    onEditorChange(item.queryText || '')
    if (item.name) {
      queryName.value = item.name
      const updated = { ...queryRecord.value, name: item.name, autoName: false }
      queryRecord.value = updated
      chrome.storage.local.set({ [queryId]: updated })
      chrome.runtime.sendMessage({ type: 'RENAME_QUERY', name: item.name, id: queryId })
    }
    showQueryPicker.value = false
  }

  const filteredPickerItems = computed(() => {
    const q = queryPickerSearch.value.trim().toLowerCase()
    if (!q) return queryPickerItems.value
    return queryPickerItems.value.filter(item => item.name?.toLowerCase().includes(q))
  })


  // ── Run helpers ───────────────────────────────────────────
  // Folder IDs are cached on the query record with the stack they belong to.
  function cachedFolder(key) {
    const bu = queryRecord.value.businessUnit || {}
    return bu[key] && bu[`${key}Stack`] === stack.value ? bu[key] : null
  }
  function writeBusinessUnit(patch) {
    const next = { ...queryRecord.value, businessUnit: { ...(queryRecord.value.businessUnit || {}), ...patch } }
    queryRecord.value = next
    chrome.storage.local.set({ [queryId]: next })
  }
  function cacheFolder(key, id) {
    writeBusinessUnit({ [key]: id, [`${key}Stack`]: stack.value })
  }
  function clearCachedFolder(key) {
    writeBusinessUnit({ [key]: null, [`${key}Stack`]: null })
  }

  // Records the business unit a query is first saved or run in, for the BU badge and the
  // Saved queries filter: on creation, on the first save and on the first run (live test,
  // 2026-11-07: a panel never run had none, so "queries from <current BU>" hid it).
  // Never blocks or fails a save or a run.
  let taggingBU = false
  function tagBusinessUnit() {
    if (!queryRecord.value || queryRecord.value.businessUnit?.name || !stack.value || taggingBU) return
    taggingBU = true
    fetchCurrentBU(stack.value)
      .then((bu) => { if (bu && !queryRecord.value.businessUnit?.name) writeBusinessUnit(bu) })
      .catch(() => {})
      .finally(() => { taggingBU = false })
  }
  // A panel created before the stack is known is tagged once it is.
  watch(stack, (s) => { if (s && newRecord) tagBusinessUnit() })

  function shortError(err) {
    return String(err?.message || err || 'unknown error').slice(0, 160)
  }

  // A question shown in the run stepper under a step; resolves true/false.
  let promptResolver = null
  function askInStep(idx, text, confirmLabel) {
    return new Promise((resolve) => {
      promptResolver = (answer) => {
        promptResolver = null
        setStepDetail(idx, null)
        resolve(answer)
      }
      setStepDetail(idx, { prompt: { text, confirmLabel, cancelLabel: 'Cancel' } })
    })
  }
  function answerPrompt(answer) {
    if (promptResolver) promptResolver(!!answer)
  }

  // Runs `attempt`; if it fails, asks before opening Contact Builder in a background
  // tab (its traffic refreshes the session tokens), then retries once. Returns null
  // after marking the step as failed when the user declines or the retry fails.
  async function withContactBuilderRetry(idx, reason, attempt) {
    try {
      return await attempt()
    } catch (firstErr) {
      const ok = await askInStep(idx,
        `${reason} Opening Contact Builder in a background tab for a few seconds usually fixes this. Open it and retry?`,
        'Open Contact Builder and retry')
      if (pollAborted) throw new Error('Poll aborted')
      if (!ok) {
        contactBuilderNeeded.value = true
        setStep(idx, 'error', `${reason} Open Contact Builder in SFMC, then press Retry.`)
        clearInterval(elapsedTimer)
        return null
      }
      setStepDetail(idx, 'Opening Contact Builder in a background tab and retrying…')
      let cbTabId = null
      try {
        const tab = await openTab({ url: `${coreOrigin(stack.value)}/cloud/#app/Contact%20Builder`, active: false })
        cbTabId = tab?.id ?? null
      } catch {}
      try {
        await new Promise(r => setTimeout(r, 10000))
        if (pollAborted) throw new Error('Poll aborted')
        const result = await attempt()
        setStepDetail(idx, null)
        return result
      } catch (secondErr) {
        if (secondErr?.message === 'Poll aborted') throw secondErr
        contactBuilderNeeded.value = true
        setStep(idx, 'error', `${reason} It still failed after opening Contact Builder (${shortError(secondErr)}). Open Contact Builder and Automation Studio in SFMC, then press Retry.`)
        clearInterval(elapsedTimer)
        return null
      } finally {
        if (cbTabId) try { chrome.tabs.remove(cbTabId) } catch {}
      }
    }
  }

  // SFMC answers "Cannot find table 0" when it can't see the new target DE yet
  // (feedback #4). Wait and retry twice, then explain.
  function isTableMissing(err) {
    return /cannot find table/i.test(err?.message || '')
  }
  async function retryWhileTableMissing(idx, attempt) {
    for (let i = 0; ; i++) {
      try {
        return await attempt()
      } catch (err) {
        if (!isTableMissing(err)) throw err
        if (i >= 2) {
          throw new Error('SFMC could not find the new target Data Extension yet ("Cannot find table 0"). It can take a moment to become available: wait a few seconds and press Retry.')
        }
        setStepDetail(idx, 'SFMC cannot see the new Data Extension yet; waiting and retrying…')
        await new Promise(r => setTimeout(r, 5000))
        if (pollAborted) throw new Error('Poll aborted')
        setStepDetail(idx, null)
      }
    }
  }

  // ── Run ───────────────────────────────────────────────────
  // The SQL of the current run: the editor's text, or only the selected part when
  // run with Cmd/Ctrl+Enter on a selection (feedback #75). Retry keeps it.
  let runText = ''
  // { deName, actName } of the current run (utils/queryRun.js runNames).
  let runObjectNames = null
  // Preview with TOP 10 (feedback #1028): the run's SQL differs from the editor's, so the
  // run keeps the editor text it came from for the "edited since this run" check.
  let runEditorText = null
  let runPreview = false

  async function runQuery(fromStep = 0, opts = {}) {
    if (isRunning.value) return
    // Feedback #1111: the first run after Run Query opens tells which start the user wants.
    const startChoice = choiceForRun(unref(queryId))
    if (startChoice) noteChoice(startChoice).then((r) => { if (r) showToast(changeNotice(r.changedTo), 9000) })
    if (fromStep <= 0 || !runText) {
      runText = typeof opts?.sql === 'string' && opts.sql.trim() ? opts.sql : queryText.value
      runEditorText = typeof opts?.editorText === 'string' ? opts.editorText : null
      runPreview = !!opts?.preview
    }
    isRunning.value        = true
    resultsMode.value      = 'running'
    completedSummary.value = null
    runCalls               = 0
    stepStatuses.value     = Array(5).fill('pending')
    stepErrors.value       = Array(5).fill(null)
    stepDetails.value      = Array(5).fill(null)
    elapsedSeconds.value   = 0
    isRunDetailsOpen.value = false
    isResultsOpen.value    = false
    resultRows.value       = []
    resultColumns.value    = []
    totalRowCount.value    = 0
    pollAborted                = false
    sessionExpired.value       = false
    contactBuilderNeeded.value = false
    clearInterval(elapsedTimer)

    tagBusinessUnit()

    const startTime = Date.now()
    elapsedTimer = setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - startTime) / 1000)
    }, 1000)

    rowsGen++
    if (fromStep <= 0) { direct = null; directKey.value = null }
    try {
      // A plain read of one data extension: read it directly, no Query Activity (#1076).
      if (fromStep <= 0) {
        const plan = directReadPlan(runText)
        const api = { searchLocalDEsByName: (st, name, size) => searchLocalDEsByName(st, name, size, runFetch), fetchDERows: (st, key, page, size) => fetchDERows(st, key, page, size, runFetch) }
        const read = plan ? await readDirect(stack.value, plan, { api }).catch((e) => { if (e.message?.includes('SESSION_EXPIRED')) throw e; return null }) : null
        if (read) {
          direct = { key: read.de.key, columns: read.columns, top: read.top }
          directKey.value = read.de.key
          // Nothing was created: the cleanup buttons must not point at an earlier run's objects.
          createdDeId.value = null; createdDeKey.value = null; createdActivityId.value = null
          const skipped = 'Skipped: read directly'
          setStepDetail(0, 'Plain read of one data extension'); setStep(0, 'done')
          setStepDetail(1, skipped); setStep(1, 'done')
          setStepDetail(2, skipped); setStep(2, 'done')
          setStepDetail(3, { text: `Read ${read.de.name}` }); setStep(3, 'done')
          resultRows.value    = read.rows
          resultColumns.value = read.columns
          totalRowCount.value = read.total
          setStep(4, 'done')
          clearInterval(elapsedTimer)
          completedSummary.value = `Read directly from ${read.de.name} in ${formatRunTime(Date.now() - startTime)} · ${read.total.toLocaleString()} rows · no Query Activity · ${runCalls} SFMC calls`
          isRunDetailsOpen.value = false
          isResultsOpen.value    = true
          resultsMode.value      = 'results'
          const runEntry = {
            runId: String(Date.now()), runAt: Date.now(), stack: stack.value, queryText: runText,
            ...(runEditorText != null ? { editorText: runEditorText } : {}),
            ...(runPreview ? { preview: true } : {}),
            // The user's own DE: never stored as deId/deKey, so nothing offers to delete it.
            direct: { deName: read.de.name, deKey: read.de.key, columns: read.columns, top: read.top },
            deId: null, deKey: null, activityId: null, rowCount: read.rows.length,
          }
          currentRunId.value = runEntry.runId
          runs.value = [runEntry, ...(Array.isArray(runs.value) ? runs.value : Object.values(runs.value))]
          const updated = { ...queryRecord.value, runs: runsForStorage(runs.value, historyAllowed(keepHistory.value)) }
          queryRecord.value = updated
          await new Promise((resolve) => chrome.storage.local.set({ [queryId]: updated }, resolve))
          // The rest of the rows, up to LOAD_ALL_LIMIT, load on their own (user, 2026-11-06).
          if (read.total > read.rows.length) {
            fetchAllRows().catch((e) => showToast(`Could not load the rest of the rows: ${e.message}`, 8000, { kind: 'error' }))
          }
          return
        }
      }

      // Step 0 - Validate
      if (fromStep <= 0) {
        setStep(0, 'running')
        if (!runText.trim()) {
          setStep(0, 'error', 'Query is empty')
          clearInterval(elapsedTimer)
          return
        }
        try {
          const qaId   = await getAnyQueryActivityId(stack.value, runFetch)
          const result = await validateQueryText(stack.value, qaId, cleanQueryText(runText), runFetch)
          if (!result.queryValid) {
            const msg = (result.errors ?? []).map(e => e.message).join('; ') || 'Query is invalid'
            throw new Error(msg)
          }
          const warnings = result.warnings ?? []
          setStepDetail(0, warnings.length > 0
            ? { text: `Valid (${warnings.length} warning${warnings.length > 1 ? 's' : ''})`, warnings: warnings.map(w => w.message || String(w)) }
            : 'Valid'
          )
        } catch (err) {
          if (err.message?.includes('SESSION_EXPIRED')) throw err
          if (err.message === 'NO_ACTIVITIES') {
            setStepDetail(0, 'Skipped (no existing activities)')
          } else {
            setStep(0, 'error', err.message)
            clearInterval(elapsedTimer)
            return
          }
        }
        setStep(0, 'done')
      }

      // Reuse an existing query activity + DE if this exact query was run before
      // and the setting is on (off by default — see isReuseEnabled above).
      if (fromStep === 0 && await isReuseEnabled()) {
        const normalizedText = runText.trim()
        const reuseRun = runs.value.find(r =>
          r.queryText?.trim() === normalizedText &&
          r.activityId && r.deId && r.deKey &&
          (!r.stack || r.stack === stack.value)
        )
        if (reuseRun) {
          createdDeId.value      = reuseRun.deId
          createdDeKey.value     = reuseRun.deKey
          createdDeName.value    = reuseRun.deName || null
          createdActivityId.value = reuseRun.activityId
          createdActivityName.value = reuseRun.activityName || null
          // Runs from before field names and the marker were kept (live test, 2026-11-07)
          // show the rowset's names and cannot tell a failed run.
          targetFieldNames = Array.isArray(reuseRun.fields) ? reuseRun.fields : []
          targetFields = []
          targetHasMarker = reuseRun.marker === true
          setStep(1, 'done')
          setStepDetail(1, { text: `↩ Reusing DE · ${(reuseRun.deKey || '').slice(0, 20)}`, href: reuseRun.deUrl || null })
          setStep(2, 'done')
          setStepDetail(2, { text: `↩ Reusing · ${reuseRun.activityName || 'existing activity'}`, href: reuseRun.activityUrl || null })
          fromStep = 3
        }
      }

      // Step 1 - Create target DE
      if (fromStep <= 1) {
        setStep(1, 'running')
        // Unique per run, shared by the DE and the Query Activity (live test, 2026-11-07).
        runObjectNames = runNames()
        let deName = runObjectNames.deName

        // ── Resolve DE folder (contactsmeta API) ──
        // The folder ID is cached on the query record together with its stack; a
        // cache from another stack (or one that later fails) is not reused.
        const cachedDeFolderId = cachedFolder('deFolderId')
        let deCategoryID = cachedDeFolderId
        if (!deCategoryID) {
          deCategoryID = await withContactBuilderRetry(1,
            'The Data Extension folder could not be read.',
            () => getOrCreateDEFolder(stack.value, runFetch))
          if (deCategoryID == null) return
          cacheFolder('deFolderId', deCategoryID)
        }

        const target = await resolveTargetFields(runText)
        const renames = target.renames
        activitySql = target.activitySql
        // The results must hold exactly what the query returns: no primary key (SFMC
        // keeps one row per key and drops the rest without an error: a UNION ALL of 40
        // rows twice showed 40 rows, live test 2026-11-08) and no required field (a LEFT
        // JOIN gives NULLs).
        const resultFields = target.fields.map((f) => ({ ...f, isPrimaryKey: false, isNullable: true }))
        // The run marker column tells a failed run from an empty result (utils/queryRun.js).
        const marker = markerField(resultFields)
        const fields = marker ? [...resultFields, marker] : resultFields
        targetFieldNames = target.fields.map((f) => f.name)
        targetFields = fields
        targetHasMarker = !!marker

        // createTargetDE POSTs to core (exacttarget.com) and may need a CSRF token that
        // is only captured passively from real core traffic (see CLAUDE.md "Core CSRF
        // has no known silent-bootstrap path"). Loading Contact Builder produces that
        // traffic, so on failure the user is asked whether to open it and retry.
        const days = await retentionDays()
        const createDE = (categoryID) => createTargetDE(stack.value, { name: deName, fields, categoryID, retentionDays: days }, runFetch)
        let deResult
        try {
          deResult = await createDE(deCategoryID)
        } catch (createErr) {
          if (createErr.message?.includes('SESSION_EXPIRED')) throw createErr
          if (isNameClash(createErr)) {
            // A taken name is not a session problem, so no Contact Builder advice (live
            // test, 2026-11-07): try once more with new names; a second failure is the step's error.
            runObjectNames = runNames()
            deName = runObjectNames.deName
            deResult = await createDE(deCategoryID)
          } else {
            if (cachedDeFolderId) {
              // The cached folder may be gone or belong to another business unit.
              clearCachedFolder('deFolderId')
              deCategoryID = await withContactBuilderRetry(1,
                'The Data Extension folder could not be read.',
                () => getOrCreateDEFolder(stack.value, runFetch))
              if (deCategoryID == null) return
              cacheFolder('deFolderId', deCategoryID)
            }
            deResult = await withContactBuilderRetry(1,
              `Creating the Data Extension failed (${shortError(createErr)}).`,
              () => createDE(deCategoryID))
            if (deResult == null) return
          }
        }
        createdDeId.value   = deResult.id
        createdDeKey.value  = deResult.customerKey
        createdDeName.value = deName
        const deUrl = `https://mc.${stack.value}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${deResult.id}/properties/`
        const renameNote = renames.size > 0
          ? ` · renamed ${[...renames].map(([from, to]) => `${from} → ${to}`).join(', ')}`
          : ''
        setStepDetail(1, { text: `${deName} · QuerySaver${renameNote}`, href: deUrl, copyText: deName })
        setStep(1, 'done')
      }

      // Step 2 - Create query activity
      if (fromStep <= 2) {
        setStep(2, 'running')
        let actName = (runObjectNames ||= runNames()).actName
        let qaCategoryId = cachedFolder('qaFolderId')
        if (!qaCategoryId) {
          qaCategoryId = await getOrCreateQAFolder(stack.value, runFetch)
          cacheFolder('qaFolderId', qaCategoryId)
        }
        const createActivity = (categoryId) => retryWhileTableMissing(2, () => createQueryActivity(stack.value, {
          name: actName, queryText: activitySql ?? cleanQueryText(runText),
          targetName: createdDeKey.value, targetKey: createdDeKey.value,
          targetId: createdDeId.value, categoryId,
        }, runFetch))
        let actResult
        try {
          actResult = await createActivity(qaCategoryId)
        } catch (actErr) {
          if (isNameClash(actErr)) {
            // Same name as another run's activity (live test, 2026-11-07): new name, once.
            actName = runNames().actName
            actResult = await createActivity(qaCategoryId)
          } else {
            if (!queryRecord.value.businessUnit?.qaFolderId || isTableMissing(actErr)) throw actErr
            // The cached Query Activity folder may be gone or belong to another business unit.
            clearCachedFolder('qaFolderId')
            qaCategoryId = await getOrCreateQAFolder(stack.value, runFetch)
            cacheFolder('qaFolderId', qaCategoryId)
            actResult = await createActivity(qaCategoryId)
          }
        }
        createdActivityId.value   = actResult.queryDefinitionId
        createdActivityName.value = actName
        const actUrl = `${coreOrigin(stack.value)}/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/${actResult.queryDefinitionId}`
        setStepDetail(2, { text: actName, href: actUrl, copyText: actName })
        setStep(2, 'done')
      }

      // Step 3 - Start + poll
      let earlyFetchResult = null
      if (fromStep <= 3) {
        setStep(3, 'running')
        const marked = targetHasMarker && await placeRunMarker(createdDeKey.value)
        await retryWhileTableMissing(3, () => startQueryActivity(stack.value, createdActivityId.value, runFetch))
        try {
          earlyFetchResult = await pollUntilComplete(stack.value, createdActivityId.value, createdDeKey.value, marked)
        } catch (err) {
          // SFMC does not say why a Query Activity started on its own failed; the same
          // activity run once inside an automation does (live test, 2026-11-08).
          if (!(err instanceof RunFailedError)) throw err
          throw await failureReason(err)
        }
        setStep(3, 'done')
      }

      // Step 4 - Fetch results
      if (fromStep <= 4) {
        setStep(4, 'running')
        let items, totalCount
        if (earlyFetchResult?.items?.length > 0) {
          items      = earlyFetchResult.items
          totalCount = earlyFetchResult.totalCount
        } else {
          const data = await fetchDERows(stack.value, createdDeKey.value, 1, 2500, runFetch)
          items      = data.items || []
          totalCount = data.count ?? items.length
        }
        // Keyed and ordered by the target DE's field names (live test, 2026-11-07).
        const { rows, markerSeen } = toResultRows(items, targetFieldNames)
        resultRows.value    = rows
        resultColumns.value = toResultColumns(targetFieldNames, rows)
        totalRowCount.value = Math.max(0, totalCount - (markerSeen ? 1 : 0))
        setStep(4, 'done')
      }

      clearInterval(elapsedTimer)
      completedSummary.value =
        `Completed in ${formatRunTime(Date.now() - startTime)} · ${(totalRowCount.value ?? resultRows.value.length).toLocaleString()} rows · ${runCalls} SFMC calls`
      isRunDetailsOpen.value = false
      isResultsOpen.value    = true
      resultsMode.value = 'results'

      const runEntry = {
        runId:        String(Date.now()),
        runAt:        Date.now(),
        stack:        stack.value,
        queryText:    runText,
        ...(runEditorText != null ? { editorText: runEditorText } : {}),
        ...(runPreview ? { preview: true } : {}),
        deId:         createdDeId.value,
        deKey:        createdDeKey.value,
        deName:       createdDeName.value,
        deUrl:        `https://mc.${stack.value}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${createdDeId.value}/properties/`,
        activityId:   createdActivityId.value,
        activityName: createdActivityName.value,
        activityUrl:  `${coreOrigin(stack.value)}/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/${createdActivityId.value}`,
        rowCount:     resultRows.value.length,
        // The target DE's field names (result columns) and whether it has the run marker.
        fields:       [...targetFieldNames],
        ...(targetHasMarker ? { marker: true } : {}),
      }
      currentRunId.value = runEntry.runId
      runs.value = [runEntry, ...(Array.isArray(runs.value) ? runs.value : Object.values(runs.value))]
      const updated = { ...queryRecord.value, runs: runsForStorage(runs.value, historyAllowed(keepHistory.value)) }
      queryRecord.value = updated
      await new Promise((resolve) => chrome.storage.local.set({ [queryId]: updated }, resolve))

    } catch (err) {
      clearInterval(elapsedTimer)
      const runningIdx = stepStatuses.value.indexOf('running')
      if (err.message?.includes('SESSION_EXPIRED')) {
        sessionExpired.value = true
        resultsMode.value = 'empty'
        stepStatuses.value = Array(5).fill('pending')
      } else {
        if (runningIdx !== -1) setStep(runningIdx, 'error', err.message)    }
    } finally {
      isRunning.value = false
    }
  }

  // The target DE's fields for a query: names from its SELECT, types from the source
  // DEs, data views or CASTs; '_' names renamed with a wrapped query (activitySql).
  // Used by Run and by Save as query activity (feedback #88).
  async function resolveTargetFields(runText) {
    // ENT.X is a DE shared from the parent BU: look it up by its bare name,
    // which fetchDEMetadata also finds under Shared Items.
    const sourceDeNames = [...new Set(extractDataExtensions(runText).map(bareTableName))]
      .filter(n => n && !isSkippableDE(n))
    const selectCols = extractSelectColumns(runText)
    const colDetails = inferSelectColumnDetails(runText)
    const fieldMap = {}
    for (const sourceName of sourceDeNames) {
      try {
        const meta       = await fetchDEMetadata(stack.value, sourceName, runFetch)
        const fieldsData = await fetchDEFields(stack.value, meta.id, runFetch)
        for (const f of (fieldsData?.fields || [])) {
          fieldMap[f.name.toLowerCase()] = f
        }
      } catch {}
    }
    let typedColumns
    if (selectCols.length > 0) {
      // Data view fields are a fallback source of types for columns the
      // fetched source DEs don't cover (`s.EventDate AS SendDate` from _Sent).
      const dvFieldMap = {}
      for (const srcName of extractDataExtensions(runText)) {
        for (const f of (DATA_VIEW_FIELDS[srcName.toUpperCase()] || [])) dvFieldMap[f.name.toLowerCase()] = f
      }
      const lookupField = (n) => fieldMap[n] ?? dvFieldMap[n]
      typedColumns = selectCols.map(name => {
        const d = colDetails[name.toLowerCase()] || {}
        // An explicit CAST/function type wins over a same-named source field.
        if (d.type !== undefined) return { name, type: d.type, length: d.length, scale: d.scale, isPrimaryKey: false, isNullable: true }
        // Pass-through columns ("s.EventDate AS SendDate") keep the source field's type,
        // but never its primary key flag: the output may repeat values.
        const src = lookupField(d.source ?? name.toLowerCase())
        if (src) return { name, type: src.type ?? 0, length: src.length, scale: src.scale, isPrimaryKey: d.source ? false : (src.isPrimaryKey ?? false), isNullable: src.isNullable ?? true }
        return { name, type: 0, length: DEFAULT_TEXT_LENGTH, scale: 0, isPrimaryKey: false, isNullable: true }
      })
    } else {
      typedColumns = Object.values(fieldMap).map(f => ({
        name: f.name, type: f.type ?? 0, length: f.length ?? DEFAULT_TEXT_LENGTH,
        scale: f.scale ?? 0, isPrimaryKey: f.isPrimaryKey ?? false, isNullable: f.isNullable ?? true,
      }))
      if (typedColumns.length === 0) {
        // Fall back to built-in data view field definitions
        for (const srcName of extractDataExtensions(runText)) {
          const dvFields = DATA_VIEW_FIELDS[srcName.toUpperCase()]
          if (dvFields) {
            for (const f of dvFields) {
              if (!fieldMap[f.name.toLowerCase()]) fieldMap[f.name.toLowerCase()] = f
            }
          }
        }
        typedColumns = Object.values(fieldMap).map(f => ({
          name: f.name, type: f.type ?? 0, length: f.length ?? DEFAULT_TEXT_LENGTH,
          scale: f.scale ?? 0, isPrimaryKey: f.isPrimaryKey ?? false, isNullable: f.isNullable ?? true,
        }))
      }
      if (typedColumns.length === 0) {
        throw new Error('SELECT * requires a resolvable source DE - could not fetch fields from the source table')
      }
    }
    // SFMC refuses field names that start with '_' (_ContactKey on synchronized
    // DEs, for example). Rename them (t_ContactKey, or t1_, t2_ on a clash) and
    // run a wrapped query that outputs the new names.
    const renames = planUnderscoreRenames(typedColumns.map(c => c.name))
    const wrapped = renames.size > 0
      ? wrapWithRenamedColumns(cleanQueryText(runText), typedColumns.map(c => c.name), renames)
      : null
    if (renames.size > 0) {
      typedColumns = typedColumns.map(c => renames.has(c.name) ? { ...c, name: renames.get(c.name) } : c)
    }
    const fields = buildDEFields(typedColumns)
    return { fields, renames, activitySql: wrapped }
  }

  // Why a run failed: the activity runs once more, inside a temporary automation whose
  // run log has SFMC's reason (sfmcApi.js createRunAutomation). Only failed runs pay for
  // this: run times are set by SFMC's queue, and a new automation was no faster (live
  // test, 2026-11-08: 52 to 169 seconds against 11 to 46 on its own). Returns the error
  // to show: SFMC's reason, or `original` when none could be had.
  async function failureReason(original) {
    setStepDetail(3, { note: 'The run failed. Running it once more inside a temporary automation to get SFMC\'s reason...' })
    let automation = null
    try {
      automation = await createAutomationForRun()
      if (!automation) return original
      await runAutomationOnce(stack.value, automation.id, runFetch)
      await pollAutomation(stack.value, automation.id)
      return original // it completed this time: nothing more to say
    } catch (err) {
      if (err?.message?.includes('SESSION_EXPIRED') || err?.message === 'Poll aborted') throw err
      return err instanceof RunFailedError ? err : original
    } finally {
      if (automation) deleteRunAutomation(automation)
      if (stepDetails.value[3]?.note?.startsWith('The run failed.')) setStepDetail(3, null)
    }
  }

  // The automation ({ id, name }), or null when SFMC refuses it (no rights to create
  // automations, for example). A session that expired still stops the run.
  async function createAutomationForRun() {
    const create = async (name) => {
      const r = await createRunAutomation(stack.value, { name, activityId: createdActivityId.value, activityName: createdActivityName.value || name }, runFetch)
      return r?.id ? { id: r.id, name } : null
    }
    try {
      try {
        return await create((runObjectNames ||= runNames()).autoName)
      } catch (err) {
        // A retry or a reused activity can meet the last run's automation before its
        // deletion went through: new name, once.
        if (!isNameClash(err)) throw err
        return await create(runNames().autoName)
      }
    } catch (err) {
      if (err?.message?.includes('SESSION_EXPIRED')) throw err
      return null
    }
  }

  // Deleted right away, without holding up the error. One that could not be deleted is
  // named SFMCQS_run_ and shows in Settings > Clean up.
  function deleteRunAutomation(automation) {
    deleteAutomation(stack.value, automation.id, runFetch).catch(() => undefined)
  }

  // Waits for the automation's run (utils/queryRun.js waitForAutomationRun); a failed
  // run throws with SFMC's reason.
  async function pollAutomation(stackId, automationId) {
    return waitForAutomationRun({
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      aborted: () => pollAborted,
      // A failed read decides nothing; the next poll reads again.
      latestRun: () => fetchLatestAutomationRun(stackId, automationId, runFetch).catch((err) => {
        if (err?.message?.includes('SESSION_EXPIRED')) throw err
        return null
      }),
    })
  }

  // Puts the run marker row into the target DE before the start and waits until SFMC
  // shows it (its insert is asynchronous), so the run's overwrite comes after it.
  // Returns false when SFMC refuses it or it does not show in time: the run then goes
  // on without telling a failed run from an empty result (utils/queryRun.js).
  async function placeRunMarker(deKey) {
    try {
      await insertDERowsAsync(stack.value, deKey, [markerRow(targetFields)], runFetch)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        if (pollAborted) throw new Error('Poll aborted')
        const data = await fetchDERows(stack.value, deKey, 1, 1, runFetch)
        if ((data?.items || []).length) return true
      }
    } catch (err) {
      if (err?.message === 'Poll aborted' || err?.message?.includes('SESSION_EXPIRED')) throw err
    }
    return false
  }

  // Waits for the started run (utils/queryRun.js waitForRun): its first page of rows,
  // or a RunFailedError when SFMC left the marker row, i.e. the run failed (live test,
  // 2026-11-07: failed runs used to show as "Completed · 0 rows").
  async function pollUntilComplete(stackId, activityId, deKey, marker) {
    // After a minute, say why it can take long (feedback #1076).
    const pollStart = Date.now()
    return waitForRun({
      marker,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      aborted: () => pollAborted,
      onTick: () => {
        if (Date.now() - pollStart >= 60000 && !stepDetails.value[3]?.note) {
          setStepDetail(3, { note: 'SFMC is still running the query. Query Activities can wait behind other work in this account, and TOP does not make them start sooner. Open the activity from Create Activity to see it in Automation Studio.' })
        }
      },
      isRunning: () => getQueryActivityStatus(stackId, activityId, runFetch),
      // A failed read decides nothing; the next poll reads again.
      readRows: () => fetchDERows(stackId, deKey, 1, 2500, runFetch).catch((err) => {
        if (err?.message?.includes('SESSION_EXPIRED')) throw err
        return null
      }),
    })
  }

  function setStepDetail(idx, detail) {
    const details = [...stepDetails.value]
    details[idx] = detail
    stepDetails.value = details
  }

  function setStep(idx, status, error = null) {
    const statuses = [...stepStatuses.value]
    statuses[idx]  = status
    stepStatuses.value = statuses
    if (error) {
      const errors = [...stepErrors.value]
      errors[idx]  = error
      stepErrors.value = errors
    }
  }

  // ── Cleanup ───────────────────────────────────────────────
  async function handleDeleteDE(runId) {
    const run = runs.value.find(r => r.runId === runId)
    if (!run?.deId) return
    isDeleting.value = { ...isDeleting.value, de: true }
    deleteError.value = null
    try {
      await deleteDE(run.stack || stack.value, run.deId)
      runs.value = runs.value.map(r => r.runId === runId ? { ...r, deId: null, deKey: null } : r)
      if (runId === currentRunId.value) { createdDeId.value = null; createdDeKey.value = null }
      const updated = { ...queryRecord.value, runs: runsForStorage(runs.value, historyAllowed(keepHistory.value)) }
      queryRecord.value = updated
      await new Promise(resolve => chrome.storage.local.set({ [queryId]: updated }, resolve))
    } catch (e) {
      deleteError.value = 'Failed to delete Data Extension: ' + e.message
    } finally {
      isDeleting.value = { ...isDeleting.value, de: false }
    }
  }

  async function handleDeleteActivity(runId) {
    const run = runs.value.find(r => r.runId === runId)
    if (!run?.activityId) return
    isDeleting.value = { ...isDeleting.value, activity: true }
    deleteError.value = null
    try {
      await deleteQueryActivity(run.stack || stack.value, run.activityId)
      runs.value = runs.value.map(r => r.runId === runId ? { ...r, activityId: null } : r)
      if (runId === currentRunId.value) { createdActivityId.value = null }
      const updated = { ...queryRecord.value, runs: runsForStorage(runs.value, historyAllowed(keepHistory.value)) }
      queryRecord.value = updated
      await new Promise(resolve => chrome.storage.local.set({ [queryId]: updated }, resolve))
    } catch (e) {
      deleteError.value = 'Failed to delete Query Activity: ' + e.message
    } finally {
      isDeleting.value = { ...isDeleting.value, activity: false }
    }
  }

  function openDeleteConfirm(run) {
    if (deleteConfirm.value?.runId === run.runId) { deleteConfirm.value = null; return }
    deleteConfirm.value = {
      runId: run.runId,
      hasDe: !!run.deId,
      hasActivity: !!run.activityId,
      deleteDe: !!run.deId,
      deleteActivity: !!run.activityId,
    }
  }

  async function handleDeleteRun(runId, deleteDe, deleteActivity) {
    const run = runs.value.find(r => r.runId === runId)
    if (!run) return
    deleteError.value = null
    deleteConfirm.value = null
    try {
      if (deleteDe && run.deId) {
        await deleteDE(run.stack || stack.value, run.deId)
      }
      if (deleteActivity && run.activityId) {
        await deleteQueryActivity(run.stack || stack.value, run.activityId)
      }
      runs.value = runs.value.filter(r => r.runId !== runId)
      if (runId === currentRunId.value) {
        createdDeId.value = null; createdDeKey.value = null; createdActivityId.value = null
      }
      const updated = { ...queryRecord.value, runs: runsForStorage(runs.value, historyAllowed(keepHistory.value)) }
      queryRecord.value = updated
      await new Promise(resolve => chrome.storage.local.set({ [queryId]: updated }, resolve))
    } catch (e) {
      deleteError.value = 'Failed to delete: ' + e.message
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      copiedText.value = text
      setTimeout(() => { copiedText.value = null }, 1500)
    } catch {}
  }

  function formatRunDate(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  // ── Resize handle ─────────────────────────────────────────
  function onResizeStart(e) {
    isResizing = true
    _resizeContainer = e.currentTarget?.closest?.('.query-panel') || e.target?.closest?.('.query-panel')
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
  }
  let _resizeContainer = null
  function onResizeMove(e) {
    if (!isResizing) return
    const container = _resizeContainer || document.querySelector('.query-panel')
    if (!container) return
    const rect = container.getBoundingClientRect()
    const pct  = ((e.clientY - rect.top) / rect.height) * 100
    editorHeightPct.value = Math.max(20, Math.min(80, pct))
  }
  function onResizeEnd() {
    isResizing = false
    _resizeContainer = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }

  // Also adds OFFSET 0 ROWS to an ORDER BY without TOP, which SFMC refuses otherwise
  // (feedback #1093). The editor text is left as written.
  function cleanQueryText(sql) {
    return addOffsetToOrderBy((sql || '').trim().replace(/;+\s*$/, '')).sql
  }

  function openSfmcLogin() {
    const s = stack.value
    const url = s ? `${coreOrigin(s)}/cloud/` : 'https://mc.exacttarget.com'
    openTab({ url })
  }

  function openAutomationStudio() {
    const s = stack.value ?? 's10'
    openTab({
      url: `${coreOrigin(s)}/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`,
    })
  }

  const showRunStepper = computed(() => resultsMode.value === 'running')

  let newRecord = false
  async function loadQueryRecord() {
    if (initialSql) queryText.value = initialSql
    await new Promise((resolve) => {
      chrome.storage.local.get(queryId, (data) => {
        const rec = data[queryId]
        if (rec) {
          queryRecord.value = rec
          queryText.value = rec.queryText || initialSql || ''
          queryName.value = rec.name || new Date(rec.timeStamp).toLocaleString()
          if (rec.runs) {
            runs.value = Array.isArray(rec.runs) ? rec.runs : Object.values(rec.runs).sort((a, b) => (b.runAt || 0) - (a.runAt || 0))
          }
        } else {
          const ts = Date.now()
          const defaultName = suggestQueryName(initialSql)
          queryRecord.value = { id: queryId, name: defaultName, autoName: true, queryText: initialSql || '', timeStamp: ts, isFavourite: false, url: '' }
          queryName.value = defaultName
          queryText.value = initialSql || ''
          newRecord = true
          chrome.storage.local.set({ [queryId]: queryRecord.value }, () => { tagBusinessUnit(); resolve() })
          return
        }
        resolve()
      })
    })
  }

  onMounted(() => { loadQueryRecord(); readSnapshots().catch(() => undefined) })

  return {
    queryId, queryRecord, queryText, queryName, saveStatus,
    isEditingName, editableName, resultsMode, validationResults,
    isRunning, stepStatuses, stepErrors, stepDetails, elapsedSeconds, completedSummary,
    resultRows, resultColumns, totalRowCount, isFetchingMore,
    createdDeKey, createdDeId, createdDeName, createdActivityId, createdActivityName,
    isDeleting, deleteError, deleteConfirm,
    runs, currentRunId, copiedText, activeTab, queryViewOpen, historyResults,
    sessionExpired, contactBuilderNeeded, isRunDetailsOpen, isResultsOpen, answerPrompt,
    editorHeightPct, showRunStepper, PAGE_SIZE, LOAD_ALL_LIMIT, canInteract,
    onEditorChange, enableNameEditing, saveName, runValidation, runQuery,
    fetchMoreRows, fetchAllRows, canLoadMore, handleDeleteDE, handleDeleteActivity,
    openDeleteConfirm, handleDeleteRun, copyToClipboard, formatRunDate,
    onResizeStart, toggleHistoryResults, toggleQueryView,
    openSfmcLogin, openAutomationStudio, cleanQueryText, loadQueryRecord, resolveTargetFields,
    showQueryPicker, queryPickerLoading, queryPickerSearch, queryPickerError,
    filteredPickerItems, openQueryPicker, refreshQueryPicker, selectQueryActivity,
    relativeDate, queryPickerTree, expandedQaFolders, toggleQaFolder, queryPickerItems,
    snapshots, takeSnapshot, restoreSnapshot, readSnapshots,
  }
}
