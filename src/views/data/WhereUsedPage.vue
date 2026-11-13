<script setup>
// Where used: pick any kind of thing (data extension, data view, field, activity,
// automation, entry event, email, content block, file location, profiles) and see
// where it is used. The scan runs in the Where used panel (components/usage/).
import { computed, ref, watch } from 'vue'
import { Search, Loader2, Network, Database, ChevronRight } from 'lucide-vue-next'
import UsagePanel from '@/components/usage/UsagePanel.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useStack } from '@/composables/useStack.js'
import { useUsage, targetKey } from '@/composables/useUsage.js'
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
          key: de.id, title: de.name, code: de.customerKey, badge: de.sourceType ? (de.sourceType === 'shared' ? 'Shared' : 'Synchronized') : '', sub: formatDateTime(de.modifiedDate),
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
          .map((e) => ({ key: e.id, title: e.name || e.eventDefinitionKey, code: e.eventDefinitionKey, sub: e.dataExtensionName || '', target: { kind: 'event', event: e } }))
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

// The row whose scan is shown (or running) in the panel.
const currentKey = computed(() => (usage.state.target ? targetKey(usage.state.target) : ''))
const rowTarget = (r) => r.target || (kind.value === 'dataview' ? { kind: 'de', de: r.pick } : null)
const isCurrent = (r) => (rowTarget(r) ? targetKey(rowTarget(r)) === currentKey.value : fieldDE.value?.name === r.pick?.name)
const panelShown = computed(() => usage.state.open && !!usage.state.target)
const countText = computed(() => {
  const n = rows.value?.length || 0
  const what = kind.value === 'field' ? 'data extension' : kindInfo.value.label.toLowerCase()
  const q = query.value.trim()
  return `${n} ${n === 1 ? what : what.replace(/y$/, 'ie') + 's'}${q ? ` match "${q}"` : ''}.`
})
</script>

<template>
  <div class="h-full flex flex-col bg-background text-foreground">
    <!-- Page header: same as the Data Extensions page, with Where used as the current view -->
    <div class="border-b border-border bg-card px-5 pt-3.5 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Database class="h-[18px] w-[18px]" /></span>
          <h1 class="text-[22px] font-bold leading-tight">Data Extensions</h1>
        </div>
      </div>
      <nav aria-label="Data extension views" class="flex gap-1 overflow-x-auto whitespace-nowrap">
        <router-link to="/data-extensions" class="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground">All data extensions</router-link>
        <router-link to="/de-storage" class="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Storage</router-link>
        <span aria-current="page" class="-mb-px inline-flex h-11 items-center border-b-2 border-primary px-3 text-sm font-semibold">Where used</span>
      </nav>
    </div>

    <div class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
      <div class="flex-1 min-w-0 lg:overflow-y-auto px-5 py-[18px] flex flex-col gap-3.5">
        <!-- Picker -->
        <div class="flex flex-wrap items-center gap-2.5">
          <label class="text-[13px] text-muted-foreground" for="wu-kind">Check</label>
          <select id="wu-kind" v-model="kind" class="h-[38px] rounded-full border border-border bg-card px-3 text-sm">
            <option v-for="k in KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
          </select>
          <select v-if="kind === 'activity'" v-model="activityType" class="h-[38px] rounded-full border border-border bg-card px-3 text-sm" aria-label="Activity type">
            <option v-for="t in ACTIVITY_SEARCH_TYPES" :key="t.id" :value="t">{{ t.label }}</option>
          </select>
          <form v-if="!isProfile" class="flex flex-1 basis-[260px] min-w-0 items-center gap-2.5" @submit.prevent="search">
            <div class="flex flex-1 min-w-0 items-center gap-2.5 h-[38px] rounded-full border border-border bg-card px-4 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
              <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
              <input v-model="query" type="search" :placeholder="`${kind === 'field' ? 'Data extension' : kindInfo.label} name (empty lists the newest)`" :aria-label="`${kindInfo.label} name`"
                class="flex-1 min-w-0 bg-transparent text-sm outline-none" />
            </div>
            <button type="submit" class="h-[38px] inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 whitespace-nowrap" :disabled="loading">
              <Loader2 v-if="loading" class="h-4 w-4 animate-spin" /> Search
            </button>
          </form>
          <button v-else type="button" class="h-[38px] inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90" @click="showProfiles">
            <Network class="h-4 w-4" /> Find {{ PROFILE_LABELS[kind].toLowerCase() }}
          </button>
        </div>

        <p class="text-[13px] text-muted-foreground max-w-3xl">
          <template v-if="rows && !fieldDE"><strong class="text-foreground">{{ countText }}</strong> Pick one to check: </template>{{ kindInfo.hint }}
          <template v-if="!rows || fieldDE"> The scan shows each step with a progress bar and keeps going if you close it or open another section.</template>
        </p>
        <SfmcErrorNotice :error="error" :retrying="loading" @retry="search" />

        <!-- Fields of the picked data extension -->
        <template v-if="fieldDE">
          <div class="flex items-center gap-1.5 text-[13px]">
            <button class="text-primary hover:underline" @click="fieldDE = null">All results</button>
            <ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="font-semibold">{{ fieldDE.name }}</span>
          </div>
          <div v-if="fieldsLoading" class="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading fields…</div>
          <section v-else class="shrink-0 rounded-[14px] border border-border bg-card overflow-hidden">
            <div v-for="(f, i) in fieldList" :key="f.name" class="flex items-center gap-3 px-3.5 py-2.5" :class="{ 'border-t border-border': i,
              'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]': usage.state.target?.kind === 'field' && usage.state.target.field === f.name && usage.state.target.de?.name === fieldDE.name }">
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span class="text-sm" :class="f.isPrimaryKey ? 'font-semibold' : 'font-medium'">{{ f.name }}</span>
                <span class="text-xs text-muted-foreground">{{ fieldTypeLabel(f) }}<template v-if="f.isPrimaryKey"> · Primary key</template></span>
              </div>
              <button class="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-semibold text-primary hover:bg-accent"
                @click="usage.start(stack, { kind: 'field', de: fieldDE, field: f.name })"><Network class="h-3.5 w-3.5" /> Where used</button>
            </div>
            <p v-if="!fieldList.length" class="px-3.5 py-2.5 text-[13px] text-muted-foreground">No fields.</p>
          </section>
        </template>

        <!-- Search results -->
        <template v-else-if="rows">
          <p v-if="!rows.length" class="text-sm text-muted-foreground">Nothing found.</p>
          <section v-else class="shrink-0 rounded-[14px] border border-border bg-card overflow-hidden">
            <div v-for="(r, i) in rows" :key="r.key" class="flex items-center gap-3 px-3.5 py-2.5"
              :class="[i ? 'border-t border-border' : '', isCurrent(r) ? 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]' : '']">
              <div class="flex-1 min-w-0 flex flex-col gap-[3px]">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-semibold break-words">{{ r.title }}</span>
                  <span v-if="r.badge" class="rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{{ r.badge }}</span>
                </span>
                <span v-if="r.code || r.sub" class="text-xs text-muted-foreground truncate">
                  <code v-if="r.code" class="font-mono text-[11px]">{{ r.code }}</code><template v-if="r.code && r.sub"> · </template>{{ r.sub }}
                </span>
              </div>
              <button class="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold"
                :class="isCurrent(r) && rowTarget(r) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-primary hover:bg-accent'" @click="open(r)">
                <template v-if="rowTarget(r)">
                  <Loader2 v-if="isCurrent(r) && usage.state.running" class="h-3.5 w-3.5 animate-spin" /><Network v-else class="h-3.5 w-3.5" />
                  {{ isCurrent(r) ? (usage.state.running ? 'Scanning' : 'Showing') : 'Check' }}
                </template>
                <template v-else><Network class="h-3.5 w-3.5" /> Pick a field</template>
              </button>
              <button v-if="kind === 'dataview'" class="h-8 shrink-0 inline-flex items-center rounded-full border border-border bg-card px-3 text-[13px] font-semibold text-primary hover:bg-accent"
                @click="kind = 'field'; $nextTick(() => pickDE(r.pick))">Fields</button>
            </div>
          </section>
        </template>

        <div v-else-if="!isProfile && !loading" class="max-w-md mt-6 text-sm text-muted-foreground">
          Search for a {{ kind === 'field' ? 'data extension, then pick one of its fields' : kindInfo.label.toLowerCase() }}. Search with an empty box to list the newest.
        </div>
      </div>

      <!-- The scan and its results (the same panel that floats on other pages) -->
      <div v-if="panelShown" class="flex flex-col min-h-0 h-[85vh] lg:h-auto shrink-0 lg:w-[min(520px,45%)] border-t lg:border-t-0 lg:border-l border-border">
        <UsagePanel embedded />
      </div>
    </div>
  </div>
</template>
