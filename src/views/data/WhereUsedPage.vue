<script setup>
// Where used: pick any kind of thing (data extension, data view, field, activity,
// automation, entry event, email, content block, file location, profiles) and see
// where it is used. The scan runs in the Where used panel (components/usage/).
import { computed, ref, watch } from 'vue'
import { Search, Loader2, Network } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useStack } from '@/composables/useStack.js'
import { useUsage } from '@/composables/useUsage.js'
import { searchLocalDEs, searchSharedSyncDEs, fetchDEFieldList, fieldTypeLabel } from '@/utils/deApi.js'
import { ACTIVITY_SEARCH_TYPES, searchActivities, searchAutomations } from '@/utils/automationApi.js'
import { fetchEventDefinitions } from '@/utils/journeyApi.js'
import { DATA_VIEWS, DATA_VIEW_FIELDS } from '@/utils/dataViews.js'
import { searchAssets, listFileLocations } from '@/utils/usage/sources.js'
import { PROFILE_LABELS } from '@/utils/usage/index.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const usage = useUsage()

const KINDS = [
  { id: 'de', label: 'Data extension', hint: 'SQL queries (with lineage), imports, filters, data extracts, scripts, Send Email activities, entry events, journeys, emails, content blocks and CloudPages.' },
  { id: 'dataview', label: 'Data view', hint: 'SQL queries that read it, the automations they run in, and where their results go.' },
  { id: 'field', label: 'Field', hint: 'SQL queries that read or write the field, journey criteria and AMPscript lookups that name it.' },
  { id: 'activity', label: 'Automation activity', hint: 'The automations and steps that run it.' },
  { id: 'automation', label: 'Automation', hint: 'What it touches: data extensions read and written, files, emails, entry events.' },
  { id: 'event', label: 'Journey entry event', hint: 'Its data extension and the journeys that use it.' },
  { id: 'email', label: 'Email', hint: 'Journeys and Send Email activities (and their automations) that send it.' },
  { id: 'block', label: 'Content block', hint: 'Emails, templates, other blocks and CloudPages that include it.' },
  { id: 'location', label: 'File location', hint: 'Imports and file transfers that use it, and their automations.' },
  { id: 'sender', label: 'Sender profiles', hint: 'Every sender profile used by journeys and Send Email activities.' },
  { id: 'delivery', label: 'Delivery profiles', hint: 'Every delivery profile used by journeys and Send Email activities.' },
  { id: 'classification', label: 'Send classifications', hint: 'Every send classification used by journeys and Send Email activities.' },
]
const kind = ref('de')
const kindInfo = computed(() => KINDS.find((k) => k.id === kind.value))
const isProfile = computed(() => ['sender', 'delivery', 'classification'].includes(kind.value))

const query = ref('')
const activityType = ref(ACTIVITY_SEARCH_TYPES[0])
const loading = ref(false)
const error = ref('')
const rows = ref(null) // [{ key, title, sub, target | pick }]
const fieldDE = ref(null) // the DE whose fields are listed (kind field)
let all = null // lists loaded whole (entry events, file locations), filtered here
let runId = 0

watch([kind, activityType], () => { rows.value = null; error.value = ''; fieldDE.value = null; all = null; query.value = '' })

const contains = (v, q) => String(v || '').toLowerCase().includes(q.trim().toLowerCase())

async function search() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  const id = ++runId
  loading.value = true
  error.value = ''
  fieldDE.value = null
  const q = query.value
  const s = stack.value
  try {
    const out = await withReconnect(s, async () => {
      let out = []
      if (kind.value === 'de' || kind.value === 'field') {
        const [local, shared] = await Promise.all([searchLocalDEs(s, q, 1), searchSharedSyncDEs(s, q).catch(() => [])])
        const seen = new Set()
        out = [...shared, ...local.items].filter((d) => !seen.has(d.id) && seen.add(d.id)).map((de) => ({
          key: de.id, title: de.name, sub: [de.customerKey, de.sourceType ? (de.sourceType === 'shared' ? 'Shared' : 'Synchronized') : '', formatDateTime(de.modifiedDate)].filter(Boolean).join(' · '),
          ...(kind.value === 'de' ? { target: { kind: 'de', de } } : { pick: de }),
        }))
      } else if (kind.value === 'dataview') {
        out = [...DATA_VIEWS].filter((n) => contains(n, q)).sort().map((name) => ({ key: name, title: name, sub: '', pick: { name, dataView: true } }))
      } else if (kind.value === 'activity') {
        const r = await searchActivities(s, activityType.value.endpoint, q, 1)
        const idField = { 300: 'queryDefinitionId', 423: 'ssjsActivityId', 43: 'importDefinitionId', 73: 'dataExtractDefinitionId', 53: 'id', 303: 'filterActivityId' }[activityType.value.objectTypeId]
        out = r.items.map((it) => ({
          key: it[idField] ?? it.id, title: it.name, sub: formatDateTime(it.modifiedDate),
          target: { kind: 'activity', typeId: activityType.value.objectTypeId, activityObjectId: it[idField] ?? it.id, name: it.name, details: activityType.value.objectTypeId === 300 ? it : null },
        }))
      } else if (kind.value === 'automation') {
        const r = await searchAutomations(s, q, 0)
        out = r.entries.map((a) => ({ key: a.id, title: a.name, sub: [a.status, a.lastRunTime ? `last run ${formatDateTime(a.lastRunTime)}` : ''].filter(Boolean).join(' · '), target: { kind: 'automation', id: a.id, name: a.name } }))
      } else if (kind.value === 'event') {
        all = all || (await fetchEventDefinitions(s)).items
        out = all.filter((e) => contains(e.name, q) || contains(e.eventDefinitionKey, q) || contains(e.dataExtensionName, q)).slice(0, 100)
          .map((e) => ({ key: e.id, title: e.name || e.eventDefinitionKey, sub: [e.eventDefinitionKey, e.dataExtensionName].filter(Boolean).join(' · '), target: { kind: 'event', event: e } }))
      } else if (kind.value === 'email' || kind.value === 'block') {
        const items = await searchAssets(s, q, kind.value)
        out = items.map((a) => ({ key: a.id, title: a.name, sub: [a.assetType?.displayName || a.assetType?.name, a.category?.name, formatDateTime(a.modifiedDate)].filter(Boolean).join(' · '), target: { kind: kind.value, asset: a } }))
      } else if (kind.value === 'location') {
        all = all || await listFileLocations(s)
        out = all.filter((l) => contains(l.name, q) || contains(l.relPath, q)).map((l) => ({ key: l.id, title: l.name || l.id, sub: [l.locationType || l.locationTypeId, l.relPath].filter(Boolean).join(' · '), target: { kind: 'location', location: l } }))
      }
      return out
    })
    if (id === runId) rows.value = out
  } catch (e) {
    if (id === runId) error.value = searchError(e, 'search')
  } finally {
    if (id === runId) loading.value = false
  }
}

// Field: after picking a DE (or data view), list its fields.
const fieldList = ref([])
const fieldsLoading = ref(false)
async function pickDE(de) {
  if (kind.value === 'dataview') {
    usage.start(stack.value, { kind: 'de', de })
    return
  }
  fieldDE.value = de
  fieldList.value = []
  fieldsLoading.value = true
  try {
    fieldList.value = de.dataView
      ? (DATA_VIEW_FIELDS[de.name.toUpperCase()] || []).map((f) => ({ name: f.name }))
      : await fetchDEFieldList(stack.value, de.id)
  } catch (e) {
    error.value = `Could not load the fields: ${e.message}`
  } finally {
    fieldsLoading.value = false
  }
}
function open(row) {
  if (row.target) usage.start(stack.value, row.target)
  else pickDE(row.pick)
}
function showProfiles() {
  usage.start(stack.value, { kind: 'profiles', profileType: kind.value })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-card">
      <label class="text-xs text-muted-foreground" for="wu-kind">Check</label>
      <select id="wu-kind" v-model="kind" class="h-8 rounded-md border border-border bg-background px-2 text-xs">
        <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
      </select>
      <select v-if="kind === 'activity'" v-model="activityType" class="h-8 rounded-md border border-border bg-background px-2 text-xs" aria-label="Activity type">
        <option v-for="t in ACTIVITY_SEARCH_TYPES" :key="t.id" :value="t">{{ t.label }}</option>
      </select>
      <form v-if="!isProfile" class="flex items-center gap-2" @submit.prevent="search">
        <div class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input v-model="query" type="search" :placeholder="`${kind === 'field' ? 'Data extension' : kindInfo.label} name (empty lists the newest)`" :aria-label="`${kindInfo.label} name`"
            class="h-8 w-72 rounded-md border border-border bg-background pl-7 pr-2 text-xs" />
        </div>
        <Button size="sm" class="h-8 text-xs" type="submit" :disabled="loading"><Loader2 v-if="loading" class="h-3.5 w-3.5 mr-1 animate-spin" /> Search</Button>
      </form>
      <Button v-else size="sm" class="h-8 text-xs" @click="showProfiles"><Network class="h-3.5 w-3.5 mr-1" /> Find {{ PROFILE_LABELS[kind].toLowerCase() }}</Button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <p class="mb-3 text-xs text-muted-foreground max-w-2xl">{{ kindInfo.hint }} Results open in the Where used panel, which shows each step of the scan with a progress bar and keeps going if you close it.</p>
      <SfmcErrorNotice :error="error" :retrying="loading" @retry="search" />

      <template v-if="fieldDE">
        <div class="mb-2 flex items-center gap-2 text-xs">
          <button class="text-primary hover:underline" @click="fieldDE = null">All results</button>
          <span class="text-muted-foreground">/</span>
          <span class="font-semibold">{{ fieldDE.name }}</span>
        </div>
        <div v-if="fieldsLoading" class="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading fields…</div>
        <ul v-else class="divide-y divide-border rounded-md border border-border bg-card max-w-2xl">
          <li v-for="f in fieldList" :key="f.name" class="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span class="font-medium" :class="{ 'font-semibold': f.isPrimaryKey }">{{ f.name }}</span>
            <span class="text-muted-foreground">{{ fieldTypeLabel(f) }}</span>
            <div class="flex-1" />
            <button class="inline-flex items-center gap-1 text-primary hover:underline" @click="usage.start(stack, { kind: 'field', de: fieldDE, field: f.name })"><Network class="h-3 w-3" /> Where used</button>
          </li>
          <li v-if="!fieldList.length" class="px-3 py-2 text-xs text-muted-foreground">No fields.</li>
        </ul>
      </template>

      <template v-else-if="rows">
        <p v-if="!rows.length" class="text-sm text-muted-foreground">Nothing found.</p>
        <ul v-else class="divide-y divide-border rounded-md border border-border bg-card max-w-3xl">
          <li v-for="r in rows" :key="r.key" class="flex items-center gap-2 px-3 py-1.5 text-xs">
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">{{ r.title }}</div>
              <div v-if="r.sub" class="text-muted-foreground truncate">{{ r.sub }}</div>
            </div>
            <button class="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap" @click="open(r)">
              <Network class="h-3 w-3" /> {{ r.target ? 'Where used' : kind === 'dataview' ? 'Where used' : 'Pick a field' }}
            </button>
            <button v-if="kind === 'dataview'" class="text-primary hover:underline whitespace-nowrap" @click="kind = 'field'; $nextTick(() => pickDE(r.pick))">Fields</button>
          </li>
        </ul>
      </template>

      <div v-else-if="!isProfile && !loading" class="max-w-md mt-8 text-sm text-muted-foreground">
        Search for a {{ kind === 'field' ? 'data extension, then pick one of its fields' : kindInfo.label.toLowerCase() }}. Search with an empty box to list the newest.
      </div>
    </div>
  </div>
</template>
