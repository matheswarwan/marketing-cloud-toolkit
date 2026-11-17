<script setup>
// Contacts > Data model (user, 2026-11-10): Contact Builder's Data Designer, read only.
// Each attribute group with its attribute sets (data extensions), how they link (fields
// and cardinality) and a diagram; sets no group reaches are listed apart. Changes are
// made in Contact Builder's Data Designer. Calls and what is unverified: utils/dataModel.js.
// Diagram (user, 2026-11-17: "look like SFMC, click and view contents, do things with
// it"): Data Designer's overview of the groups around Contacts, then a group's map of
// cards; clicking a card opens its details and actions (components/dataModel). Search
// finds a set or attribute in any group.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Search, ChevronLeft } from 'lucide-vue-next'
import DataModelOverview from '@/components/dataModel/DataModelOverview.vue'
import DataModelMap from '@/components/dataModel/DataModelMap.vue'
import DataModelSetPanel from '@/components/dataModel/DataModelSetPanel.vue'
import { searchModel } from '@/utils/dataModelMap.js'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchDataModel, linksOfSet, groupSvg } from '@/utils/dataModel.js'

const { stack } = useStack()
const model = ref(null)
const busy = ref(false)
const error = ref(null)
const open = ref(new Set())
const VIEW_KEY = 'toolkit_dataModelView'
function readView() { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'diagram' } catch { return 'diagram' } }
const view = ref(readView()) // diagram | list
watch(view, (v) => { try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } })
// The open group and set live in the address (?group=&set=), so Back from Preview data
// or Run Query, a reload or a link comes back to the same map.
const route = useRoute()
const router = useRouter()
const one = (v) => (Array.isArray(v) ? v[0] : v) || null
const groupId = ref(one(route.query.group)) // the group whose map is open (null: the overview)
const setId = ref(one(route.query.set)) // the set whose details are open
watch([groupId, setId], ([g, s]) => {
  if (one(route.query.group) === g && one(route.query.set) === s) return
  const query = { ...route.query }
  if (g) query.group = g; else delete query.group
  if (s) query.set = s; else delete query.set
  router.replace({ path: route.path, query })
})
const query = ref('')
async function load() {
  busy.value = true
  error.value = null
  try {
    model.value = await fetchDataModel(stack.value)
    open.value = new Set(model.value.groups.slice(0, 1).map((g) => g.id))
  } catch (e) { error.value = searchError(e, 'read the data model') } finally { busy.value = false }
}
whenStack(load)

const toggle = (id) => { const s = new Set(open.value); s.has(id) ? s.delete(id) : s.add(id); open.value = s }
const yesNo = (v) => (v ? 'Yes' : 'No')
const rowsOf = (sets, links) => sets.map((s) => ({ ...s, rootText: yesNo(s.root), sendableText: yesNo(s.sendable), linksText: linksOfSet(s, links).join('; ') }))
const columns = [
  { key: 'name', label: 'Attribute set' }, { key: 'linksText', label: 'Relationships' }, { key: 'rootText', label: 'Root' },
  { key: 'sendableText', label: 'Sendable' }, { key: 'storage', label: 'Storage' }, { key: 'key', label: 'Key', hidden: true },
  { key: 'fullyQualifiedName', label: 'Full name', hidden: true }, { key: 'fieldCount', label: 'Attributes', hidden: true }, { key: 'id', label: 'ID', hidden: true },
]
const groups = computed(() => (model.value?.groups || []).map((g) => ({ ...g, rows: rowsOf(g.sets, g.links) })))
const unplacedRows = computed(() => rowsOf(model.value?.unplaced || [], model.value?.relationships || []))
const idOf = (v) => String(v ?? '').toLowerCase()
const openGroup = computed(() => groups.value.find((g) => idOf(g.id) === groupId.value) || null)
const openSet = computed(() => (setId.value && model.value?.sets.find((s) => idOf(s.id) === setId.value)) || null)
const found = computed(() => searchModel(model.value, query.value))
const matches = computed(() => (query.value.trim() ? new Set(found.value.map((f) => idOf(f.set.id))) : null))
function showGroup(id) { groupId.value = idOf(id); setId.value = null }
function backToOverview() { groupId.value = null; setId.value = null }
// A set picked from search or from a link: its group's map, with the set picked.
function pickSet(id) {
  if (!id) { setId.value = null; return }
  const k = idOf(id)
  if (!openGroup.value?.sets.some((s) => idOf(s.id) === k)) {
    const g = groups.value.find((x) => x.sets.some((s) => idOf(s.id) === k))
    groupId.value = g ? idOf(g.id) : null
  }
  setId.value = k
}
watch(model, () => { if (groupId.value && !openGroup.value) backToOverview() })
const designerUrl = computed(() => `https://mc.${stack.value}.marketingcloudapps.com/contactsmeta/admin.html`)

const tableBlock = (rows) => ({ type: 'table', columns: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))) })
const getDoc = () => {
  const blocks = []
  for (const g of groups.value) {
    blocks.push({ type: 'h', level: 2, text: g.name })
    if (g.sets.length) blocks.push({ type: 'svg', svg: groupSvg(g) })
    blocks.push(tableBlock(g.rows))
  }
  if (unplacedRows.value.length) blocks.push({ type: 'h', level: 2, text: 'Attribute sets in no attribute group' }, tableBlock(unplacedRows.value))
  return { title: 'Data model', blocks }
}
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl" data-data-model>
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Data model</h1>
      <span class="text-xs text-muted-foreground">Contact Builder's attribute groups and how their data extensions link. Read only: change it in Data Designer.</span>
      <div class="flex-1" />
      <div class="flex gap-0.5 border border-border rounded-md p-0.5 text-xs" role="group" aria-label="View">
        <button v-for="[k, l] in [['diagram', 'Diagram'], ['list', 'List']]" :key="k" type="button" class="px-2 py-0.5 rounded" :class="view === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-pressed="view === k" :data-view="k" @click="view = k">{{ l }}</button>
      </div>
      <a :href="designerUrl" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink class="h-3.5 w-3.5" /> Open Contact Builder</a>
      <DownloadMenu :get-doc="getDoc" file-name="data-model" :disabled="!model" />
      <Button variant="outline" size="sm" class="gap-1" :disabled="busy" @click="load"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>
    <SfmcErrorNotice v-if="error" :error="error" :retrying="busy" @retry="load" />
    <div v-if="busy && !model" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading the data model (attribute sets 50 at a time)…</div>
    <template v-if="model">
      <p class="text-xs text-muted-foreground">
        {{ model.groups.length }} attribute groups, {{ model.sets.length }} attribute sets, {{ model.relationships.length }} relationships.
        <template v-if="!model.groupSource"> SFMC did not list the attribute groups, so they are named by their ID from the relationships.</template>
      </p>
      <section v-if="view === 'diagram'" class="rounded-lg border border-border bg-card overflow-hidden" data-dm-diagram>
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
          <nav class="flex items-center gap-1 text-sm min-w-0" aria-label="Data model">
            <button v-if="openGroup" type="button" class="inline-flex items-center gap-0.5 text-primary hover:underline" data-dm-back @click="backToOverview"><ChevronLeft class="h-4 w-4" /> All attribute groups</button>
            <span v-else class="font-medium">All attribute groups</span>
            <template v-if="openGroup"><span class="text-muted-foreground">/</span><span class="font-medium truncate">{{ openGroup.name }}</span></template>
          </nav>
          <div class="flex-1" />
          <div class="relative">
            <Search class="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input v-model="query" type="search" placeholder="Find an attribute set or attribute" aria-label="Find an attribute set or attribute" class="h-8 w-72 max-w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs" data-dm-search>
            <ul v-if="query.trim()" class="absolute right-0 z-20 mt-1 w-96 max-w-[90vw] max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg text-xs" data-dm-results>
              <li v-if="!found.length" class="px-3 py-2 text-muted-foreground">Nothing matches.</li>
              <li v-for="r in found" :key="r.set.id">
                <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-accent" @click="pickSet(r.set.id); query = ''">
                  <span class="font-medium">{{ r.set.name }}</span>
                  <span class="text-muted-foreground"> · {{ r.group ? r.group.name : 'in no attribute group' }}</span>
                  <span v-if="r.fields.length" class="block text-muted-foreground truncate">Attributes: {{ r.fields.map((f) => f.name).join(', ') }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div class="grid" :class="openSet ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'" style="height: calc(100vh - 18rem); min-height: 420px">
          <DataModelMap v-if="openGroup" :group="openGroup" :selected="setId" :matches="matches" @select="pickSet" />
          <DataModelOverview v-else :groups="groups" class="p-4 h-full" @open="showGroup" />
          <DataModelSetPanel v-if="openSet" :stack="stack" :set="openSet" :model="model" @close="setId = null" @select="pickSet" />
        </div>
      </section>
      <template v-else>
      <section v-for="g in groups" :key="g.id" class="rounded-lg border border-border bg-card" :data-group="g.id">
        <button type="button" class="w-full flex items-center gap-2 px-3 py-2 text-left" :aria-expanded="open.has(g.id)" @click="toggle(g.id)">
          <ChevronDown v-if="open.has(g.id)" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" />
          <span class="font-semibold text-sm">{{ g.name }}</span>
          <span class="text-xs text-muted-foreground">{{ g.sets.length }} attribute sets</span>
        </button>
        <template v-if="open.has(g.id)">
          <div class="border-t border-border">
            <DataTable :columns="columns" :rows="g.rows" storage-key="data-model" empty-text="No attribute sets linked to this group." />
          </div>
        </template>
      </section>
      <section v-if="unplacedRows.length" class="rounded-lg border border-border bg-card">
        <div class="px-3 py-2 border-b border-border text-sm font-semibold">Attribute sets in no attribute group <span class="text-xs font-normal text-muted-foreground">{{ unplacedRows.length }}</span></div>
        <DataTable :columns="columns" :rows="unplacedRows" storage-key="data-model" empty-text="None." />
      </section>
      </template>
    </template>
  </div>
</template>
