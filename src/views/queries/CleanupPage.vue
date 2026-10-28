<script setup>
// Run Query clean-up (feedback #30): lists the data extensions and Query activities
// Run Query created in SFMC (named SFMCQS_...) and deletes the ticked ones.
import { computed, ref } from 'vue'
import { Search, Loader2, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { showToast } from '@/composables/useToast.js'
import { listToolkitDEs, listToolkitQueryActivities, deleteToolkitObjects, TOOLKIT_PREFIX } from '@/utils/cleanup.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const des = ref([])
const activities = ref([])
const ticked = ref(new Set()) // `de:<id>` / `activity:<id>`
const deleting = ref(false)
const progress = ref({ done: 0, total: 0 })
const failures = ref([])

const keyOf = (kind, item) => `${kind}:${item.id}`
const sections = computed(() => [
  { kind: 'activity', title: 'Query activities', items: activities.value, empty: 'No Query activities named SFMCQS_.' },
  { kind: 'de', title: 'Data extensions', items: des.value, empty: 'No data extensions named SFMCQS_.' },
])
const tickedCount = computed(() => ticked.value.size)

async function load() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  loading.value = true
  error.value = ''
  failures.value = []
  try {
    const [a, d] = await Promise.all([listToolkitQueryActivities(stack.value), listToolkitDEs(stack.value)])
    activities.value = a
    des.value = d
    ticked.value = new Set()
    loaded.value = true
  } catch (e) {
    error.value = `Could not list what Run Query created: ${e.message}`
  } finally {
    loading.value = false
  }
}

function toggle(kind, item) {
  const next = new Set(ticked.value)
  const k = keyOf(kind, item)
  next.has(k) ? next.delete(k) : next.add(k)
  ticked.value = next
}

function allTicked(section) {
  return section.items.length > 0 && section.items.every((it) => ticked.value.has(keyOf(section.kind, it)))
}

function toggleAll(section) {
  const next = new Set(ticked.value)
  const on = !allTicked(section)
  section.items.forEach((it) => (on ? next.add(keyOf(section.kind, it)) : next.delete(keyOf(section.kind, it))))
  ticked.value = next
}

async function deleteTicked() {
  const pickA = activities.value.filter((a) => ticked.value.has(keyOf('activity', a)))
  const pickD = des.value.filter((d) => ticked.value.has(keyOf('de', d)))
  const parts = [pickA.length && `${pickA.length} Query activit${pickA.length === 1 ? 'y' : 'ies'}`, pickD.length && `${pickD.length} data extension${pickD.length === 1 ? '' : 's'}`].filter(Boolean)
  if (!parts.length) return
  if (!window.confirm(`Delete ${parts.join(' and ')} from SFMC? This cannot be undone. Saved queries and their run history in the Toolkit are kept.`)) return
  deleting.value = true
  failures.value = []
  progress.value = { done: 0, total: pickA.length + pickD.length }
  try {
    const r = await deleteToolkitObjects(stack.value, { activities: pickA, des: pickD }, (done, total) => { progress.value = { done, total } })
    const gone = new Set(r.deleted.map((x) => keyOf(x.kind, x)))
    activities.value = activities.value.filter((a) => !gone.has(keyOf('activity', a)))
    des.value = des.value.filter((d) => !gone.has(keyOf('de', d)))
    ticked.value = new Set([...ticked.value].filter((k) => !gone.has(k)))
    failures.value = r.failed
    showToast(r.failed.length ? `Deleted ${r.deleted.length}; ${r.failed.length} could not be deleted.` : `Deleted ${r.deleted.length}.`)
  } catch (e) {
    showToast(`Delete stopped: ${e.message}`)
  } finally {
    deleting.value = false
  }
}

whenStack(load)
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <Button size="sm" variant="outline" class="h-8 text-xs" :disabled="loading || deleting" @click="load">
        <Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /><Search v-else class="h-3.5 w-3.5 mr-1" /> Find again
      </Button>
      <Button size="sm" class="h-8 text-xs bg-red-600 hover:bg-red-700 text-white" :disabled="!tickedCount || deleting" @click="deleteTicked">
        <Loader2 v-if="deleting" class="h-3.5 w-3.5 mr-1 animate-spin" /><Trash2 v-else class="h-3.5 w-3.5 mr-1" />
        {{ deleting ? `Deleting ${progress.done} of ${progress.total}` : `Delete ${tickedCount || ''} selected` }}
      </Button>
      <span class="text-xs text-muted-foreground">Only items named {{ TOOLKIT_PREFIX }}... are listed: the ones Run Query (and SFMC Query Saver) created in this business unit.</span>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      <div v-if="failures.length" class="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs" role="alert">
        <div class="font-semibold mb-1">Not deleted</div>
        <ul class="space-y-0.5"><li v-for="f in failures" :key="f.item.kind + f.item.id">{{ f.item.name }}: {{ f.error }}</li></ul>
      </div>
      <p v-if="loading && !loaded" class="text-sm text-muted-foreground">Finding what Run Query created...</p>
      <section v-for="s in sections" v-show="loaded" :key="s.kind">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="text-sm font-semibold">{{ s.title }}</h2>
          <span class="text-xs text-muted-foreground">{{ s.items.length.toLocaleString() }}</span>
        </div>
        <div class="rounded-lg border border-border bg-card overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-border text-left text-muted-foreground">
                <th class="w-8 px-3 py-2"><input type="checkbox" :checked="allTicked(s)" :disabled="!s.items.length || deleting" :aria-label="`Select every ${s.title.toLowerCase()} item`" @change="toggleAll(s)" /></th>
                <th class="px-3 py-2 font-semibold">Name</th>
                <th v-if="s.kind === 'activity'" class="px-3 py-2 font-semibold">Target</th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">Created</th>
                <th class="px-3 py-2 font-semibold whitespace-nowrap">Modified</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in s.items" :key="it.id" class="border-b border-border/50 last:border-0 hover:bg-muted/40">
                <td class="px-3 py-1.5"><input type="checkbox" :checked="ticked.has(keyOf(s.kind, it))" :disabled="deleting" :aria-label="`Select ${it.name}`" @change="toggle(s.kind, it)" /></td>
                <td class="px-3 py-1.5 font-mono">{{ it.name }}</td>
                <td v-if="s.kind === 'activity'" class="px-3 py-1.5 font-mono">{{ it.targetName || '—' }}</td>
                <td class="px-3 py-1.5 whitespace-nowrap">{{ formatDateTime(it.createdDate) }}</td>
                <td class="px-3 py-1.5 whitespace-nowrap">{{ formatDateTime(it.modifiedDate) }}</td>
              </tr>
              <tr v-if="!s.items.length"><td :colspan="s.kind === 'activity' ? 5 : 4" class="px-3 py-4 text-center text-muted-foreground">{{ s.empty }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
