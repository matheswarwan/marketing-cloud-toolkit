import { ref, computed, watch, onMounted, onUnmounted, unref } from 'vue'
import { extractDataExtensions, extractSelectColumns, inferSelectColumnDetails } from '../utils/sqlParser.js'
import { planUnderscoreRenames, wrapWithRenamedColumns } from '../utils/columnNames.js'
import { DATA_VIEW_FIELDS, isSkippableDE } from '../utils/dataViews.js'
import { bareTableName } from '../utils/schemaCatalog.js'
import { openTab } from '../utils/openTab.js'
import { useStoredSetting } from './useStoredSetting.js'
import { HISTORY_SETTING, historyAllowed, runsForStorage } from '../utils/history.js'
import {
  fetchDEMetadata, fetchDEFields, buildDEFields,
  createTargetDE, createQueryActivity,
  startQueryActivity, getQueryActivityStatus, fetchDERows,
  deleteDE, deleteQueryActivity, getOrCreateDEFolder, getOrCreateQAFolder,
  getAnyQueryActivityId, validateQueryText, listQueryActivities, listQAFolders,
  DEFAULT_TEXT_LENGTH, fetchCurrentBU,
  parseRetentionDays, sfmcCallCount,
} from '../utils/sfmcApi.js'

export function useQueryPanel(options) {
  // Query history: a run's SQL is stored only while history is on (utils/history.js).
  const { value: keepHistory } = useStoredSetting(HISTORY_SETTING, true, (v) => v !== false)
  const { queryId, stack: stackInput, panelIndex = 0, initialSql = '', onTitleChange } = options
  const stack = computed(() => unref(stackInput))
  const canInteract = computed(() => !!stack.value)

  // Format: SFMCQS_sql_YYYYMMDD_[unix_seconds]  (no dots allowed by SFMC)
  function sfmcSafeName(prefix = 'sql') {
    const now = new Date()
    const ymd = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
    const secs = Math.floor(Date.now() / 1000)
    return `SFMCQS_${prefix}_${ymd}_${secs}`.replace(/\./g, '')
  }

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
  // Columns of the target DE this run created, shown when a run returns no rows (feedback #31).
  let targetFieldNames = []
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
      const data = await fetchDERows(runStack, run.deKey, 1, 2500)
      const items = data.items || []
      const rows = items.map(item => ({ ...(item.keys || {}), ...(item.values || {}) }))
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
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

  async function fetchMoreRows() {
    if (isFetchingMore.value || !createdDeKey.value) return
    isFetchingMore.value = true
    try {
      const nextPage = Math.floor(resultRows.value.length / PAGE_SIZE) + 1
      const data = await fetchDERows(stack.value, createdDeKey.value, nextPage, PAGE_SIZE)
      const items = data.items || []
      const flat = items.map(item => ({ ...(item.keys || {}), ...(item.values || {}) }))
      resultRows.value = [...resultRows.value, ...flat]
      totalRowCount.value = data.count ?? resultRows.value.length
    } finally {
      isFetchingMore.value = false
    }
  }

  // Up to LOAD_ALL_LIMIT rows: more would make the page slow; for bigger results,
  // export the target DE in SFMC.
  const LOAD_ALL_LIMIT = 50000

  async function fetchAllRows() {
    if (isFetchingMore.value || !createdDeKey.value) return
    isFetchingMore.value = true
    try {
      let page = Math.floor(resultRows.value.length / PAGE_SIZE) + 1
      while (resultRows.value.length < LOAD_ALL_LIMIT) {
        const data = await fetchDERows(stack.value, createdDeKey.value, page, PAGE_SIZE)
        const items = data.items || []
        if (!items.length) break
        const flat = items.map(item => ({ ...(item.keys || {}), ...(item.values || {}) }))
        resultRows.value = [...resultRows.value, ...flat]
        totalRowCount.value = data.count ?? resultRows.value.length
        if (resultRows.value.length >= totalRowCount.value) break
        page++
      }
    } finally {
      isFetchingMore.value = false
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────

  onUnmounted(() => {
    pollAborted = true
    if (promptResolver) promptResolver(false)
    clearTimeout(saveTimer)
    clearInterval(elapsedTimer)
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  })

  // ── Auto-save ─────────────────────────────────────────────
  function onEditorChange(newText) {
    queryText.value  = newText
    saveStatus.value = 'saving'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      const updated = { ...queryRecord.value, queryText: newText }
      queryRecord.value = updated
      await new Promise((resolve) => chrome.storage.local.set({ [queryId]: updated }, resolve))
      saveStatus.value = 'saved'
    }, 500)
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
    const updated = { ...queryRecord.value, name: trimmed }
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

  function selectQueryActivity(item) {
    onEditorChange(item.queryText || '')
    if (item.name) {
      queryName.value = item.name
      const updated = { ...queryRecord.value, name: item.name }
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

  // Records the business unit a query first runs in, for the BU badge and filter.
  // Never blocks or fails the run.
  function tagBusinessUnit() {
    if (queryRecord.value.businessUnit?.name || !stack.value) return
    fetchCurrentBU(stack.value)
      .then((bu) => { if (bu && !queryRecord.value.businessUnit?.name) writeBusinessUnit(bu) })
      .catch(() => {})
  }

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
        const tab = await openTab({ url: `https://mc.${stack.value}.exacttarget.com/cloud/#app/Contact%20Builder`, active: false })
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

  async function runQuery(fromStep = 0, opts = {}) {
    if (isRunning.value) return
    if (fromStep <= 0 || !runText) runText = typeof opts?.sql === 'string' && opts.sql.trim() ? opts.sql : queryText.value
    isRunning.value        = true
    resultsMode.value      = 'running'
    completedSummary.value = null
    const callsAtStart     = sfmcCallCount()
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

    try {
      // Step 0 - Validate
      if (fromStep <= 0) {
        setStep(0, 'running')
        if (!runText.trim()) {
          setStep(0, 'error', 'Query is empty')
          clearInterval(elapsedTimer)
          return
        }
        try {
          const qaId   = await getAnyQueryActivityId(stack.value)
          const result = await validateQueryText(stack.value, qaId, cleanQueryText(runText))
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
        const deName      = sfmcSafeName('sql')

        // ── Resolve DE folder (contactsmeta API) ──
        // The folder ID is cached on the query record together with its stack; a
        // cache from another stack (or one that later fails) is not reused.
        const cachedDeFolderId = cachedFolder('deFolderId')
        let deCategoryID = cachedDeFolderId
        if (!deCategoryID) {
          deCategoryID = await withContactBuilderRetry(1,
            'The Data Extension folder could not be read.',
            () => getOrCreateDEFolder(stack.value))
          if (deCategoryID == null) return
          cacheFolder('deFolderId', deCategoryID)
        }

        const target = await resolveTargetFields(runText)
        const renames = target.renames
        activitySql = target.activitySql
        const fields = target.fields
        targetFieldNames = fields.map((f) => f.name)

        // createTargetDE POSTs to core (exacttarget.com) and may need a CSRF token that
        // is only captured passively from real core traffic (see CLAUDE.md "Core CSRF
        // has no known silent-bootstrap path"). Loading Contact Builder produces that
        // traffic, so on failure the user is asked whether to open it and retry.
        const days = await retentionDays()
        const createDE = (categoryID) => createTargetDE(stack.value, { name: deName, fields, categoryID, retentionDays: days })
        let deResult
        try {
          deResult = await createDE(deCategoryID)
        } catch (createErr) {
          if (cachedDeFolderId) {
            // The cached folder may be gone or belong to another business unit.
            clearCachedFolder('deFolderId')
            deCategoryID = await withContactBuilderRetry(1,
              'The Data Extension folder could not be read.',
              () => getOrCreateDEFolder(stack.value))
            if (deCategoryID == null) return
            cacheFolder('deFolderId', deCategoryID)
          }
          deResult = await withContactBuilderRetry(1,
            `Creating the Data Extension failed (${shortError(createErr)}).`,
            () => createDE(deCategoryID))
          if (deResult == null) return
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
        const actName      = sfmcSafeName('act')
        let qaCategoryId = cachedFolder('qaFolderId')
        if (!qaCategoryId) {
          qaCategoryId = await getOrCreateQAFolder(stack.value)
          cacheFolder('qaFolderId', qaCategoryId)
        }
        const createActivity = (categoryId) => retryWhileTableMissing(2, () => createQueryActivity(stack.value, {
          name: actName, queryText: activitySql ?? cleanQueryText(runText),
          targetName: createdDeKey.value, targetKey: createdDeKey.value,
          targetId: createdDeId.value, categoryId,
        }))
        let actResult
        try {
          actResult = await createActivity(qaCategoryId)
        } catch (actErr) {
          if (!queryRecord.value.businessUnit?.qaFolderId || isTableMissing(actErr)) throw actErr
          // The cached Query Activity folder may be gone or belong to another business unit.
          clearCachedFolder('qaFolderId')
          qaCategoryId = await getOrCreateQAFolder(stack.value)
          cacheFolder('qaFolderId', qaCategoryId)
          actResult = await createActivity(qaCategoryId)
        }
        createdActivityId.value   = actResult.queryDefinitionId
        createdActivityName.value = actName
        const actUrl = `https://mc.${stack.value}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/${actResult.queryDefinitionId}`
        setStepDetail(2, { text: actName, href: actUrl, copyText: actName })
        setStep(2, 'done')
      }

      // Step 3 - Start + poll
      let earlyFetchResult = null
      if (fromStep <= 3) {
        setStep(3, 'running')
        await retryWhileTableMissing(3, () => startQueryActivity(stack.value, createdActivityId.value))
        earlyFetchResult = await pollUntilComplete(stack.value, createdActivityId.value, createdDeKey.value)
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
          const data = await fetchDERows(stack.value, createdDeKey.value, 1, 2500)
          items      = data.items || []
          totalCount = data.count ?? items.length
        }
        const flatRows = items.map(item => ({ ...(item.keys || {}), ...(item.values || {}) }))
        resultRows.value    = flatRows
        resultColumns.value = flatRows.length > 0 ? Object.keys(flatRows[0]) : [...targetFieldNames]
        totalRowCount.value = totalCount
        setStep(4, 'done')
      }

      clearInterval(elapsedTimer)
      const totalSec = Math.floor((Date.now() - startTime) / 1000)
      const m = Math.floor(totalSec / 60)
      const s = totalSec % 60
      completedSummary.value =
        `Completed in ${m > 0 ? `${m}m ` : ''}${s}s · ${(totalRowCount.value ?? resultRows.value.length).toLocaleString()} rows · ${sfmcCallCount() - callsAtStart} SFMC calls`
      isRunDetailsOpen.value = false
      isResultsOpen.value    = true
      resultsMode.value = 'results'

      const runEntry = {
        runId:        String(Date.now()),
        runAt:        Date.now(),
        stack:        stack.value,
        queryText:    runText,
        deId:         createdDeId.value,
        deKey:        createdDeKey.value,
        deName:       createdDeName.value,
        deUrl:        `https://mc.${stack.value}.marketingcloudapps.com/contactsmeta/admin.html#admin/data-extension/${createdDeId.value}/properties/`,
        activityId:   createdActivityId.value,
        activityName: createdActivityName.value,
        activityUrl:  `https://mc.${stack.value}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityDetails/300/${createdActivityId.value}`,
        rowCount:     resultRows.value.length,
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
        const meta       = await fetchDEMetadata(stack.value, sourceName)
        const fieldsData = await fetchDEFields(stack.value, meta.id)
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

  async function pollUntilComplete(stackId, activityId, deKey) {
    await new Promise((r) => setTimeout(r, 15000))
    if (pollAborted) throw new Error('Poll aborted')

    async function tryFetchRows() {
      try {
        const data = await fetchDERows(stackId, deKey, 1, 2500)
        const items = data.items || []
        if (items.length > 0) return { items, totalCount: data.count ?? items.length }
      } catch {}
      return null
    }

    const STARTUP_MAX = 10
    let seenRunning = false
    for (let i = 0; i < STARTUP_MAX; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 5000))
        if (pollAborted) throw new Error('Poll aborted')
      }
      const { isRunning } = await getQueryActivityStatus(stackId, activityId)
      const rows = await tryFetchRows()
      if (rows) return rows
      if (isRunning === true) { seenRunning = true; break }
    }
    if (!seenRunning) {
      return await tryFetchRows() ?? { items: [], totalCount: 0 }
    }

    const MAX_RUNNING_POLLS = 120
    for (let i = 0; i < MAX_RUNNING_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      if (pollAborted) throw new Error('Poll aborted')
      const { isRunning } = await getQueryActivityStatus(stackId, activityId)
      const rows = await tryFetchRows()
      if (rows) return rows
      if (isRunning === false) return { items: [], totalCount: 0 }
    }
    throw new Error('Query timed out after 10 minutes')
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

  function cleanQueryText(sql) {
    return (sql || '').trim().replace(/;+\s*$/, '')
  }

  function openSfmcLogin() {
    const s = stack.value
    const url = s ? `https://mc.${s}.exacttarget.com/cloud/` : 'https://mc.exacttarget.com'
    openTab({ url })
  }

  function openAutomationStudio() {
    const s = stack.value ?? 's10'
    openTab({
      url: `https://mc.${s}.exacttarget.com/cloud/#app/Automation%20Studio/AutomationStudioFuel3/`,
    })
  }

  const showRunStepper = computed(() => resultsMode.value === 'running')

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
          const defaultName = 'Panel ' + (panelIndex + 1) + ' · ' + new Date(ts).toLocaleString()
          queryRecord.value = { id: queryId, name: defaultName, queryText: initialSql || '', timeStamp: ts, isFavourite: false, url: '' }
          queryName.value = defaultName
          queryText.value = initialSql || ''
          chrome.storage.local.set({ [queryId]: queryRecord.value }, resolve)
          return
        }
        resolve()
      })
    })
  }

  onMounted(() => loadQueryRecord())

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
    fetchMoreRows, fetchAllRows, handleDeleteDE, handleDeleteActivity,
    openDeleteConfirm, handleDeleteRun, copyToClipboard, formatRunDate,
    onResizeStart, toggleHistoryResults, toggleQueryView,
    openSfmcLogin, openAutomationStudio, cleanQueryText, loadQueryRecord, resolveTargetFields,
    showQueryPicker, queryPickerLoading, queryPickerSearch, queryPickerError,
    filteredPickerItems, openQueryPicker, refreshQueryPicker, selectQueryActivity,
    relativeDate, queryPickerTree, expandedQaFolders, toggleQaFolder, queryPickerItems,
  }
}
