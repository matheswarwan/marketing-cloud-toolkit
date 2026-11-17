<script setup>
// Contacts > Contact deletions (user, 2026-11-10): the contact delete operations SFMC has
// (REST contacts/v1 deleteOperations, 50 a page), the status of one operation by its ID,
// and the deletion summary when the account may read it (analytics routes answer 403 on
// many accounts: shown as a note, not an error). Operation fields follow SFMC's reference
// (utils/contactsLookup.js deleteOperationRow); each row keeps SFMC's full answer behind
// "All fields". Read-only: deletions are started in Contact Builder, never here.
import { computed, ref } from 'vue'
import { Loader2, RefreshCw, Search, Info } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchAllDeleteOperations, deleteOperationRow, fetchDeleteStatus, fetchDeleteSummary, deleteSummaryTotals } from '@/utils/contactsLookup.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const list = ref(null)
const count = ref(0)
const busy = ref(false)
const error = ref(null)
const summary = ref(null) // { summary } | { notAuthorized } | { error }
const expanded = ref(new Set())

async function load() {
  busy.value = true
  error.value = null
  const s = stack.value
  fetchDeleteSummary(s).then((r) => { summary.value = r }).catch((e) => { summary.value = { error: searchError(e, 'read the deletion summary') } })
  try {
    const r = await fetchAllDeleteOperations(s)
    list.value = r.items.map(deleteOperationRow)
    count.value = r.count
  } catch (e) { error.value = searchError(e, 'read the contact delete operations') } finally { busy.value = false }
}
whenStack(load)

const d = (v) => formatDateTime(v)
const n = (v) => (v == null ? '' : v.toLocaleString())
const rows = computed(() => (list.value || []).map((o, i) => ({
  ...o, key: o.id || `row-${i}`, created: d(o.createdDate), scheduled: d(o.scheduledDate), started: d(o.startDate), ended: d(o.endDate),
  restorable: d(o.restorableUntil), requestedText: n(o.requested), deletedText: n(o.deleted), failedText: n(o.failed),
})))
const columns = [
  { key: 'id', label: 'Operation ID' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'type', label: 'Deletes' },
  { key: 'list', label: 'Contacts from', hidden: true }, { key: 'created', label: 'Created' }, { key: 'scheduled', label: 'Scheduled', hidden: true },
  { key: 'started', label: 'Started', hidden: true }, { key: 'ended', label: 'Ended' }, { key: 'requestedText', label: 'Contacts' },
  { key: 'deletedText', label: 'Deleted' }, { key: 'failedText', label: 'Errors' }, { key: 'restorable', label: 'Restorable until' },
  { key: 'createdBy', label: 'Created by (user ID)', hidden: true }, { key: 'raw', label: '', sortable: false, filterable: false },
]
const totals = computed(() => (summary.value?.summary ? deleteSummaryTotals(summary.value.summary) : null))
function toggle(key) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
}

// Status of one operation (route from SFMC's docs; not checked live).
const opId = ref('')
const opBusy = ref(false)
const opError = ref(null)
const opResult = ref(null)
async function lookup() {
  const id = opId.value.trim()
  if (!id) return
  opBusy.value = true
  opError.value = null
  opResult.value = null
  try { opResult.value = await fetchDeleteStatus(stack.value, id) } catch (e) { opError.value = searchError(e, 'read the status of this operation') } finally { opBusy.value = false }
}

const pretty = (v) => JSON.stringify(v, null, 2)
const docCols = columns.filter((c) => c.label)
const getDoc = () => ({
  title: 'Contact deletions',
  blocks: [
    ...(totals.value ? [{ type: 'h', level: 2, text: 'Delete requests, last 30 days' }, { type: 'table', columns: ['Status', 'Requests'], rows: [['All', String(totals.value.total)], ...totals.value.byStatus.map((t) => [t.status, String(t.count)])] }] : []),
    { type: 'h', level: 2, text: 'Delete operations' },
    rows.value.length ? { type: 'table', columns: docCols.map((c) => c.label), rows: rows.value.map((r) => docCols.map((c) => String(r[c.key] ?? ''))) } : { type: 'p', text: 'No contact deletions found.' },
  ],
})
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Contact deletions</h1>
      <span class="text-xs text-muted-foreground">Contact delete operations and their status. Read only: deletions are started in Contact Builder.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="contact-deletions" :disabled="!list" />
      <Button variant="outline" size="sm" class="gap-1" :disabled="busy" @click="load"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>

    <section v-if="summary" class="rounded-lg border border-border bg-card p-3 text-xs" data-deletions-summary>
      <h2 class="text-sm font-semibold mb-1">Delete requests, last 30 days</h2>
      <p v-if="summary.notAuthorized" class="flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40 p-2 text-sky-900 dark:text-sky-200" data-deletions-no-access>
        <Info class="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>SFMC does not let this user or account read the deletion summary ("Account / User not authorized for operation"). This usually needs Contact Builder's contact delete permissions or the feature turned on for the account. The list of operations below does not need it.</span>
      </p>
      <SfmcErrorNotice v-else-if="summary.error" :error="summary.error" @retry="load" />
      <dl v-else-if="totals" class="flex flex-wrap gap-x-6 gap-y-1" data-deletions-totals>
        <div><dt class="text-muted-foreground">All</dt><dd class="text-base font-semibold">{{ totals.total.toLocaleString() }}</dd></div>
        <div v-for="t in totals.byStatus" :key="t.status"><dt class="text-muted-foreground">{{ t.status || 'Other' }}</dt><dd class="text-base font-semibold">{{ t.count.toLocaleString() }}</dd></div>
      </dl>
    </section>

    <SfmcErrorNotice v-if="error" :error="error" :retrying="busy" @retry="load" />
    <section class="rounded-lg border border-border bg-card">
      <div class="px-3 py-2 border-b border-border text-xs">
        <span v-if="list">{{ count.toLocaleString() }} {{ count === 1 ? 'operation' : 'operations' }}<template v-if="list.length < count">, {{ list.length.toLocaleString() }} read</template>.</span>
      </div>
      <div v-if="busy && !list" class="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading the delete operations…</div>
      <div v-else-if="list && !list.length" class="p-4 text-sm space-y-1" data-deletions-empty>
        <p>No contact deletions were found in this account.</p>
        <p class="text-xs text-muted-foreground">Deletions are started in Contact Builder (All Contacts, Delete), or through the contacts delete API. The Toolkit only reads them. To find contacts that may be worth deleting, see the Orphan contacts template under <router-link to="/templates" class="text-primary hover:underline">Automation &gt; Templates</router-link>.</p>
      </div>
      <DataTable v-else-if="list" :columns="columns" :rows="rows" row-key="key" :expanded="expanded" storage-key="contact-deletions" empty-text="No operations to show.">
        <template #cell-status="{ row }"><StatusBadge v-if="row.status" :status="row.status" /></template>
        <template #cell-raw="{ row }"><button type="button" class="text-xs text-primary hover:underline" :aria-expanded="expanded.has(row.key)" @click="toggle(row.key)">{{ expanded.has(row.key) ? 'Hide fields' : 'All fields' }}</button></template>
        <template #expanded="{ row }"><pre class="max-h-80 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{{ pretty(row.raw) }}</pre></template>
      </DataTable>
    </section>

    <section class="rounded-lg border border-border bg-card p-3 text-xs space-y-2">
      <h2 class="text-sm font-semibold">Status of an operation ID</h2>
      <form class="flex flex-wrap items-center gap-1.5" @submit.prevent="lookup">
        <input v-model="opId" aria-label="Operation ID" placeholder="Operation ID" class="h-8 w-64 rounded-md border border-border bg-background px-2" data-deletions-op />
        <Button type="submit" size="sm" class="gap-1" :disabled="opBusy || !opId.trim()"><Loader2 v-if="opBusy" class="h-3.5 w-3.5 animate-spin" /><Search v-else class="h-3.5 w-3.5" /> Check</Button>
        <span class="text-muted-foreground">The ID SFMC gave when the deletion was started.</span>
      </form>
      <SfmcErrorNotice v-if="opError" :error="opError" :retrying="opBusy" @retry="lookup" />
      <p v-if="opResult" class="text-muted-foreground">SFMC's answer. In the delete phase, <code>backgroundOperationsSummary.backgroundOperationStatusID</code> says whether the deletion has finished.</p>
      <pre v-if="opResult" class="max-h-80 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{{ pretty(opResult) }}</pre>
    </section>
  </div>
</template>
