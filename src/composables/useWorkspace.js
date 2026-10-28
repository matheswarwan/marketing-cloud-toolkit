import { ref, computed, watch } from 'vue'
import { claim, release, isClaimedElsewhere } from '@/utils/tabClaims.js'

export const MAX_PANELS = 6
export const LAYOUT_PRESETS = [
  { rows: 1, cols: 1, label: '1×1' },
  { rows: 1, cols: 2, label: '1×2' },
  { rows: 2, cols: 2, label: '2×2' },
  { rows: 2, cols: 3, label: '2×3' },
]

export const LAST_WORKSPACE_KEY = 'toolkit_lastWorkspace'

function storageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve(r?.[key] ?? null)))
}

function newQueryId() {
  return `sql_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function useWorkspace() {
  const workspaceId = ref(null)
  const layoutRows  = ref(1)
  const layoutCols  = ref(1)
  const panels      = ref([]) // { queryId, initialSql? }

  const panelCount = computed(() => panels.value.length)
  const canAddPanel = computed(() => panels.value.length < MAX_PANELS)

  function setLayout(rows, cols) {
    layoutRows.value = rows
    layoutCols.value = cols
    const capacity = rows * cols
    while (panels.value.length > capacity) {
      panels.value.pop()
    }
    while (panels.value.length < capacity && panels.value.length < MAX_PANELS) {
      panels.value.push({ queryId: newQueryId() })
    }
    saveWorkspace()
  }

  function addPanel(initialSql = '') {
    if (!canAddPanel.value) return null
    const capacity = layoutRows.value * layoutCols.value
    if (panels.value.length >= capacity) {
      // expand layout to fit
      if (layoutRows.value === 1 && layoutCols.value < 3) layoutCols.value++
      else if (layoutRows.value < 2) { layoutRows.value = 2; if (layoutCols.value < 3) layoutCols.value = 3 }
    }
    const entry = { queryId: newQueryId(), initialSql: initialSql || undefined }
    panels.value.push(entry)
    saveWorkspace()
    return entry.queryId
  }

  function removePanel(index) {
    if (panels.value.length <= 1) return
    panels.value.splice(index, 1)
    saveWorkspace()
  }

  function duplicatePanel(index) {
    if (!canAddPanel.value) return
    const src = panels.value[index]
    if (!src) return
    chrome.storage.local.get(src.queryId, (data) => {
      const rec = data[src.queryId]
      const newId = newQueryId()
      if (rec) {
        const copy = {
          ...rec,
          id: newId,
          name: (rec.name || 'Query') + ' (copy)',
          timeStamp: Date.now(),
          runs: [],
        }
        chrome.storage.local.set({ [newId]: copy })
      }
      panels.value.push({ queryId: newId })
      saveWorkspace()
    })
  }

  async function saveWorkspace() {
    if (!workspaceId.value) return
    const record = {
      id: workspaceId.value,
      layout: { rows: layoutRows.value, cols: layoutCols.value },
      panels: panels.value.map(p => ({ queryId: p.queryId })),
      timeStamp: Date.now(),
    }
    await new Promise((resolve) => {
      chrome.storage.local.set({ [workspaceId.value]: record }, resolve)
    })
  }

  // The workspace shown when the section opens: the one asked for, else the last one
  // used (kept under LAST_WORKSPACE_KEY), else a new one.
  // The last workspace is skipped when another tab has it open, so two tabs never
  // save over each other's panels.
  async function restore(wsId) {
    let id = wsId
    if (!id) {
      const last = await storageGet(LAST_WORKSPACE_KEY)
      id = last && !(await isClaimedElsewhere(last)) ? last : null
    }
    const data = id ? await storageGet(id) : null
    if (data?.panels?.length) {
      workspaceId.value = id
      layoutRows.value = data.layout?.rows ?? 1
      layoutCols.value = data.layout?.cols ?? 1
      panels.value = data.panels.map(p => ({ queryId: p.queryId }))
    } else {
      workspaceId.value = `workspace_${Date.now()}`
      layoutRows.value = 1
      layoutCols.value = 1
      panels.value = [{ queryId: newQueryId() }]
      await saveWorkspace()
    }
    claim(workspaceId.value)
    chrome.storage.local.set({ [LAST_WORKSPACE_KEY]: workspaceId.value })
  }

  // Opens a saved query (`id`) or new SQL (`sql`) in this workspace: an empty panel
  // takes it, else a new panel. A query already open is just reported back.
  // Returns { queryId, added } or { full: true } when all 6 panels are in use.
  async function openInPanel({ id, sql }) {
    if (id) {
      const open = panels.value.find(p => p.queryId === id)
      if (open) return { queryId: id, added: false }
    }
    const entry = id ? { queryId: id } : { queryId: newQueryId(), initialSql: sql || undefined }
    const emptyIdx = await findEmptyPanel()
    if (emptyIdx >= 0) {
      panels.value.splice(emptyIdx, 1, entry)
    } else {
      if (!canAddPanel.value) return { full: true }
      const capacity = layoutRows.value * layoutCols.value
      if (panels.value.length >= capacity) {
        if (layoutRows.value === 1 && layoutCols.value < 3) layoutCols.value++
        else if (layoutRows.value < 2) { layoutRows.value = 2; if (layoutCols.value < 3) layoutCols.value = 3 }
      }
      panels.value.push(entry)
    }
    await saveWorkspace()
    return { queryId: entry.queryId, added: true }
  }

  // A panel that was never typed in has no stored record.
  async function findEmptyPanel() {
    for (let i = 0; i < panels.value.length; i++) {
      const p = panels.value[i]
      if (p.initialSql) continue
      const rec = await storageGet(p.queryId)
      if (!rec || !(rec.queryText || '').trim()) return i
    }
    return -1
  }

  async function newWorkspace() {
    release(workspaceId.value)
    workspaceId.value = `workspace_${Date.now()}`
    layoutRows.value = 1
    layoutCols.value = 1
    panels.value = [{ queryId: newQueryId() }]
    await saveWorkspace()
    claim(workspaceId.value)
    chrome.storage.local.set({ [LAST_WORKSPACE_KEY]: workspaceId.value })
  }

  watch([layoutRows, layoutCols], () => saveWorkspace())

  return {
    workspaceId, layoutRows, layoutCols, panels, panelCount, canAddPanel,
    LAYOUT_PRESETS, setLayout, addPanel, removePanel, duplicatePanel,
    restore, openInPanel, newWorkspace, saveWorkspace,
  }
}
