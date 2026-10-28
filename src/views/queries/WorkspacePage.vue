<script setup>
// Query Workspace: up to 6 SQL panels, each with its own editor, validate and run
// (from SFMC Query Saver). The page is kept alive while you visit other sections, so
// a running query keeps going. `?id=` (a saved query) or `?sql=` adds a panel.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, FilePlus2, LogIn } from 'lucide-vue-next'
import WorkspaceGrid from '@/components/workspace/WorkspaceGrid.vue'
import Button from '@/components/ui/button/Button.vue'
import { useWorkspace, LAYOUT_PRESETS } from '@/composables/useWorkspace.js'
import { useStack } from '@/composables/useStack.js'
import { showToast } from '@/composables/useToast.js'
import { openTab } from '@/utils/openTab.js'

const route = useRoute()
const router = useRouter()
const { stack, state } = useStack()
const {
  layoutRows, layoutCols, panels, canAddPanel,
  setLayout, addPanel, removePanel, duplicatePanel, restore, openInPanel, newWorkspace,
} = useWorkspace()

const ready = ref(false)
const canInteract = computed(() => state.value === 'connected' && !!stack.value)

// Handles ?ws=, ?id= and ?sql=, then clears them so a reload or a later visit
// doesn't open the same query again.
async function applyRoute() {
  const { ws, id, sql } = route.query
  if (!ready.value) {
    await restore(typeof ws === 'string' ? ws : null)
    ready.value = true
  }
  if (id || sql) {
    const r = await openInPanel({ id: typeof id === 'string' ? id : null, sql: typeof sql === 'string' ? sql : null })
    if (r.full) showToast('All 6 panels are in use. Close one, then open the query again.')
  }
  if (ws || id || sql) router.replace({ path: route.path })
}

applyRoute()
// Fires for later visits too: a kept-alive page still sees route changes.
watch(() => route.query, (q) => { if (ready.value && route.path === '/queries/workspace' && (q.id || q.sql || q.ws)) applyRoute() })

function openLogin() {
  openTab({ url: stack.value ? `https://mc.${stack.value}.exacttarget.com/cloud/` : 'https://mc.exacttarget.com' })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <div class="flex items-center gap-0.5 border border-border rounded-md p-0.5" role="group" aria-label="Layout">
        <button v-for="preset in LAYOUT_PRESETS" :key="preset.label"
          class="text-xs px-2 py-0.5 rounded"
          :class="layoutRows === preset.rows && layoutCols === preset.cols ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'"
          :aria-pressed="layoutRows === preset.rows && layoutCols === preset.cols"
          @click="setLayout(preset.rows, preset.cols)">{{ preset.label }}</button>
      </div>
      <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="!canAddPanel" @click="addPanel()">
        <Plus class="h-3.5 w-3.5 mr-1" /> Panel
      </Button>
      <span class="text-xs text-muted-foreground">{{ panels.length }} of 6 panels</span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-8 text-xs" title="Start with one empty panel; the queries in the current panels stay saved" @click="newWorkspace">
        <FilePlus2 class="h-3.5 w-3.5 mr-1" /> Start fresh
      </Button>
    </div>

    <div v-if="state === 'disconnected'" class="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
      <span class="flex-1">Not connected to Marketing Cloud. Log in to SFMC in this browser to validate and run queries.</span>
      <Button size="sm" variant="outline" class="h-7 text-xs" @click="openLogin"><LogIn class="h-3.5 w-3.5 mr-1" /> Log in</Button>
    </div>

    <WorkspaceGrid v-if="ready" :panels="panels" :stack="stack" :can-interact="canInteract"
      :layout-rows="layoutRows" :layout-cols="layoutCols"
      @remove-panel="removePanel" @duplicate-panel="duplicatePanel" />
  </div>
</template>
