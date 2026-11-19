<script setup>
import QueryStudioNotice from '@/components/shell/QueryStudioNotice.vue'
// Query Workspace: up to 6 SQL panels, each with its own editor, validate and run
// (from SFMC Query Saver). The page is kept alive while you visit other sections, so
// a running query keeps going. `?id=` (a saved query) or `?sql=` adds a panel; `?ai=`
// (Home's "Describe the query you need", feedback #1029) opens a panel with AI Assist.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, FilePlus2, LogIn, Bookmark, History } from 'lucide-vue-next'
import WorkspaceGrid from '@/components/workspace/WorkspaceGrid.vue'
import Button from '@/components/ui/button/Button.vue'
import { useWorkspace, LAYOUT_PRESETS } from '@/composables/useWorkspace.js'
import { useStack } from '@/composables/useStack.js'
import { showToast } from '@/composables/useToast.js'
import { openTab } from '@/utils/openTab.js'
import { pendingAiRequest } from '@/composables/useAi.js'
import { coreOrigin } from '@/utils/sfmcHosts.js'
import { loadStartPrefs, beginOpening, endOpening, noteChoice, changeNotice } from '@/utils/runQueryStart.js'

const route = useRoute()
const router = useRouter()
const { stack, state } = useStack()
const {
  layoutRows, layoutCols, panels, canAddPanel,
  setLayout, addPanel, removePanel, duplicatePanel, restore, openInPanel, newWorkspace,
} = useWorkspace()

const ready = ref(false)
const canInteract = computed(() => state.value === 'connected' && !!stack.value)
// The panels from last time when Run Query opened empty (feedback #1111).
const previousId = ref(null)

// Handles ?ws=, ?id= and ?sql=, then clears them so a reload or a later visit
// doesn't open the same query again.
async function applyRoute() {
  const { ws, id, sql, ai } = route.query
  if (!ready.value) {
    // Opened for a given query or workspace: no start choice to learn from.
    const plain = !ws && !id && !sql && !ai
    const { start } = await loadStartPrefs()
    const r = await restore(typeof ws === 'string' ? ws : null, { startEmpty: start === 'empty' && !ws })
    previousId.value = r.previousId
    if (plain && r.restoredIds.length) beginOpening('last', r.restoredIds)
    else if (plain && r.previousId) beginOpening('empty')
    ready.value = true
  } else if (id || sql || ws || ai) {
    endOpening()
  }
  if (id || sql) {
    const r = await openInPanel({ id: typeof id === 'string' ? id : null, sql: typeof sql === 'string' ? sql : null })
    if (r.full) showToast('All 6 panels are in use. Close one, then open the query again.')
  }
  if (typeof ai === 'string' && ai.trim()) {
    const r = await openInPanel({ sql: '' })
    if (r.full) showToast('All 6 panels are in use. Close one, then ask again.')
    else pendingAiRequest.value = { queryId: r.queryId, request: ai.trim() }
  }
  if (ws || id || sql || ai) router.replace({ path: route.path })
}

applyRoute()
// Fires for later visits too: a kept-alive page still sees route changes.
watch(() => route.query, (q) => { if (ready.value && route.path === '/queries/workspace' && (q.id || q.sql || q.ws || q.ai)) applyRoute() })

function learned(r) { if (r) showToast(changeNotice(r.changedTo), 9000) }

async function startFresh() {
  noteChoice('fresh').then(learned)
  previousId.value = null
  await newWorkspace()
}

async function reopenLast() {
  const id = previousId.value
  if (!id) return
  noteChoice('kept').then(learned)
  previousId.value = null
  await restore(id)
}

function openLogin() {
  openTab({ url: stack.value ? `${coreOrigin(stack.value)}/cloud/` : 'https://mc.exacttarget.com' })
}
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <div class="px-5 pt-3 empty:hidden"><QueryStudioNotice /></div>
    <div class="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border bg-card">
      <!-- Feedback #1113: Start fresh first, filled, so it is easy to find. -->
      <button class="h-[34px] inline-flex items-center gap-1.5 px-3.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
        data-testid="start-fresh"
        title="Start with one empty panel; the queries in the current panels stay saved (Saved queries)" @click="startFresh">
        <FilePlus2 class="h-4 w-4" /> Start fresh
      </button>
      <button v-if="previousId" class="h-[34px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-primary/60 bg-card text-sm font-medium text-primary hover:bg-accent"
        data-testid="reopen-last"
        title="Run Query opened empty (Settings > Running queries). Bring back the panels from last time." @click="reopenLast">
        <History class="h-4 w-4" /> Reopen last panels
      </button>
      <span class="h-6 w-px bg-border" aria-hidden="true"></span>
      <span class="text-[13px] text-muted-foreground">Layout</span>
      <div class="inline-flex items-center p-[3px] border border-border rounded-full bg-card" role="group" aria-label="Layout">
        <button v-for="preset in LAYOUT_PRESETS" :key="preset.label"
          class="h-7 px-3 rounded-full text-[13px] transition-colors"
          :class="layoutRows === preset.rows && layoutCols === preset.cols ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground/80 font-medium hover:bg-accent'"
          :aria-pressed="layoutRows === preset.rows && layoutCols === preset.cols"
          @click="setLayout(preset.rows, preset.cols)">{{ preset.label }}</button>
      </div>
      <button class="h-[34px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-border bg-card text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
        :disabled="!canAddPanel" title="Add a panel (6 at most)" @click="addPanel()">
        <Plus class="h-4 w-4" /> Panel
      </button>
      <span class="text-[13px] text-muted-foreground">{{ panels.length }} of 6 panels</span>
      <span class="ml-auto flex flex-wrap gap-2">
        <RouterLink to="/queries/saved" class="h-[34px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-border bg-card text-sm font-medium text-foreground hover:bg-accent no-underline">
          <Bookmark class="h-4 w-4" /> Saved queries
        </RouterLink>
      </span>
    </div>

    <div v-if="state === 'disconnected'" class="flex items-center gap-3 px-5 py-2 bg-amber-50 border-b border-amber-200 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
      <span class="flex-1">Not connected to Marketing Cloud. Log in to SFMC in this browser to validate and run queries.</span>
      <Button size="sm" variant="outline" class="h-8 rounded-full text-[13px]" @click="openLogin"><LogIn class="h-3.5 w-3.5 mr-1" /> Log in</Button>
    </div>

    <WorkspaceGrid v-if="ready" :panels="panels" :stack="stack" :can-interact="canInteract"
      :layout-rows="layoutRows" :layout-cols="layoutCols"
      @remove-panel="removePanel" @duplicate-panel="duplicatePanel" />
  </div>
</template>
