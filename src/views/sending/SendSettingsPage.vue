<script setup>
// Sending > Send settings (user, 2026-11-10): send classifications (Commercial or
// Transactional, sender profile, delivery profile key), sender profiles, and which
// triggered sends (and transactional definitions, when their list names one) use each
// classification. Gentle "to review" hints: a Transactional classification used by a send
// whose name reads like marketing, and sender profiles with no From address or a free mail
// domain. SOAP SendClassification, SenderProfile, TriggeredSendDefinition. Read-only.
// IP addresses (feedback #1077): SOAP PrivateIP. Delivery profiles have no Retrieve in
// SFMC's SOAP API (checked live), so only their keys show, on the classifications.
import { computed, ref } from 'vue'
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchSendSettings } from '@/utils/setupApi.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const data = ref(null)
const busy = ref(false)
const error = ref(null)
const onlyFlagged = ref(false)
const open = ref(new Set())
async function load() {
  busy.value = true
  error.value = null
  try { data.value = await fetchSendSettings(stack.value) } catch (e) { error.value = searchError(e, 'read the send settings') } finally { busy.value = false }
}
whenStack(load)

function toggle(id) {
  const next = new Set(open.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  open.value = next
}

const classRows = computed(() => (data.value?.classifications || [])
  .map((c) => ({
    ...c, id: c.key || c.id, profileName: c.profile?.name || c.senderProfileKey, fromName: c.profile?.fromName || '', fromAddress: c.profile?.fromAddress || '',
    triggeredCount: c.triggered.length, transactionalCount: c.transactional.length, flagsText: c.flags.join('; '),
    modified: formatDateTime(c.modifiedDate), created: formatDateTime(c.createdDate),
  }))
  .filter((c) => !onlyFlagged.value || c.flagsText))
const profileRows = computed(() => (data.value?.profiles || [])
  .map((p) => ({ ...p, id: p.key || p.id, flagsText: p.flags.join('; '), modified: formatDateTime(p.modifiedDate), created: formatDateTime(p.createdDate) }))
  .filter((p) => !onlyFlagged.value || p.flagsText))
const summary = computed(() => {
  const d = data.value
  if (!d) return null
  return {
    classes: d.classifications.length, commercial: d.classifications.filter((c) => c.typeLabel === 'Commercial').length,
    transactional: d.classifications.filter((c) => c.typeLabel === 'Transactional').length, profiles: d.profiles.length,
    flagged: d.classifications.filter((c) => c.flags.length).length + d.profiles.filter((p) => p.flags.length).length,
    unused: d.classifications.filter((c) => !c.usedBy).length,
  }
})

const classColumns = [
  { key: 'name', label: 'Name' }, { key: 'typeLabel', label: 'Type' }, { key: 'profileName', label: 'Sender profile' },
  { key: 'fromName', label: 'From name' }, { key: 'fromAddress', label: 'From address' }, { key: 'deliveryProfileKey', label: 'Delivery profile' },
  { key: 'usedBy', label: 'Used by' }, { key: 'flagsText', label: 'To review' },
  { key: 'key', label: 'External key', hidden: true }, { key: 'description', label: 'Description', hidden: true }, { key: 'type', label: 'SFMC type', hidden: true },
  { key: 'archiveEmail', label: 'Archive email', hidden: true }, { key: 'modified', label: 'Modified', hidden: true, sortValue: (r) => r.modifiedDate },
  { key: 'created', label: 'Created', hidden: true, sortValue: (r) => r.createdDate },
]
const profileColumns = [
  { key: 'name', label: 'Name' }, { key: 'fromName', label: 'From name' }, { key: 'fromAddress', label: 'From address' },
  { key: 'classificationCount', label: 'Classifications' }, { key: 'flagsText', label: 'To review' },
  { key: 'senderHeaderName', label: 'Sender header name', hidden: true }, { key: 'senderHeaderAddress', label: 'Sender header address', hidden: true },
  { key: 'autoForwardAddress', label: 'Auto forward to', hidden: true }, { key: 'key', label: 'External key', hidden: true }, { key: 'description', label: 'Description', hidden: true },
  { key: 'modified', label: 'Modified', hidden: true, sortValue: (r) => r.modifiedDate }, { key: 'created', label: 'Created', hidden: true, sortValue: (r) => r.createdDate },
]
const ipRows = computed(() => (data.value?.privateIps || []).map((p) => ({ ...p, key: String(p.id ?? p.address), activeText: p.active ? 'Yes' : 'No' })))
const ipColumns = [
  { key: 'address', label: 'IP address' }, { key: 'name', label: 'Name' }, { key: 'activeText', label: 'Active' },
  { key: 'order', label: 'Order', hidden: true }, { key: 'id', label: 'ID', hidden: true },
]
const table = (title, cols, rows) => [{ type: 'h', text: title }, { type: 'table', columns: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => String(r[c.key] ?? ''))) }]
const getDoc = () => {
  const used = classRows.value.flatMap((c) => [...c.triggered.map((t) => [c.name, 'Triggered send', t.name, t.key, t.status]), ...c.transactional.map((t) => [c.name, 'Transactional', t.name, t.key, t.status])])
  return {
    title: 'Send settings',
    blocks: [
      ...table('Send classifications', classColumns, classRows.value),
      ...table('Sender profiles', profileColumns, profileRows.value),
      ...(data.value?.privateIps ? table('IP addresses', ipColumns, ipRows.value) : []),
      { type: 'h', text: 'Used by' }, { type: 'table', columns: ['Classification', 'Kind', 'Send', 'External key', 'Status'], rows: used },
    ],
  }
}
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Send settings</h1>
      <span class="text-xs text-muted-foreground">Send classifications, sender profiles and the sends that use them. Read only: change them in Email Studio admin.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="send-settings" :disabled="!data" />
      <Button variant="outline" size="sm" class="gap-1" :disabled="busy" @click="load"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>
    <SfmcErrorNotice v-if="error" :error="error" :retrying="busy" @retry="load" />
    <div v-if="busy && !data" class="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading the send settings…</div>
    <template v-if="data">
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span>{{ summary.classes }} classifications ({{ summary.commercial }} Commercial, {{ summary.transactional }} Transactional), {{ summary.profiles }} sender profiles, {{ summary.unused }} classifications not used by a triggered send</span>
        <label class="flex items-center gap-1.5"><input v-model="onlyFlagged" type="checkbox" data-send-settings-flagged /> Only those to review ({{ summary.flagged }})</label>
      </div>
      <p class="text-xs text-muted-foreground">To review is a hint, not a verdict: a Transactional classification used by a send whose name has words like newsletter, promo, offer, sale or campaign (Transactional sends skip unsubscribes, so marketing content should go out as Commercial), and sender profiles with no From address or a free mail domain such as gmail.com (those usually fail DMARC checks). Used by counts triggered sends that are not deleted, plus transactional email definitions when SFMC's list names their classification.</p>
      <p v-for="n in data.notes" :key="n" class="text-xs text-amber-700 dark:text-amber-400">{{ n }}</p>
      <section class="rounded-lg border border-border bg-card">
        <h2 class="px-3 py-2 border-b border-border text-sm font-semibold">Send classifications</h2>
        <DataTable :columns="classColumns" :rows="classRows" storage-key="send-classifications" :expanded="open" empty-text="No send classifications to show.">
          <template #cell-usedBy="{ row }">
            <button v-if="row.usedBy" class="inline-flex items-center gap-0.5 text-primary hover:underline" :aria-expanded="open.has(row.id)" @click="toggle(row.id)">
              <ChevronDown v-if="open.has(row.id)" class="h-3 w-3" /><ChevronRight v-else class="h-3 w-3" />
              {{ row.triggeredCount }} triggered<template v-if="row.transactionalCount">, {{ row.transactionalCount }} transactional</template>
            </button>
            <span v-else class="text-muted-foreground">None</span>
          </template>
          <template #cell-flagsText="{ row }"><span class="text-amber-700 dark:text-amber-400">{{ row.flagsText }}</span></template>
          <template #expanded="{ row }">
            <ul class="text-xs space-y-0.5">
              <li v-for="t in row.triggered" :key="'t' + t.key"><span class="text-muted-foreground">Triggered send:</span> {{ t.name }} <span class="text-muted-foreground">({{ t.status }}, key {{ t.key }})</span></li>
              <li v-for="t in row.transactional" :key="'m' + t.key"><span class="text-muted-foreground">Transactional:</span> {{ t.name }} <span class="text-muted-foreground">({{ t.status }}, key {{ t.key }})</span></li>
            </ul>
          </template>
        </DataTable>
      </section>
      <section class="rounded-lg border border-border bg-card">
        <h2 class="px-3 py-2 border-b border-border text-sm font-semibold">Sender profiles</h2>
        <DataTable :columns="profileColumns" :rows="profileRows" storage-key="sender-profiles" empty-text="No sender profiles to show.">
          <template #cell-flagsText="{ row }"><span class="text-amber-700 dark:text-amber-400">{{ row.flagsText }}</span></template>
        </DataTable>
      </section>
      <section class="rounded-lg border border-border bg-card" data-send-settings-ips>
        <h2 class="px-3 py-2 border-b border-border text-sm font-semibold">IP addresses</h2>
        <p v-if="data.privateIps && !data.privateIps.length" class="px-3 py-2 text-sm" data-send-settings-no-ips>SFMC lists no private (dedicated) IP addresses for this account. Without one, its email goes out on Salesforce's shared IP addresses.</p>
        <DataTable v-else-if="data.privateIps" :columns="ipColumns" :rows="ipRows" row-key="key" storage-key="private-ips" empty-text="No IP addresses to show." />
        <p class="px-3 py-2 text-xs text-muted-foreground border-t border-border">The private IP addresses SFMC has for this account's email sends. Which IP and domain each delivery profile uses cannot be read: SFMC's API has no way to read delivery profiles, so only their keys show on the classifications. Sending domains are on Setup &gt; Domains.</p>
      </section>
    </template>
  </div>
</template>
