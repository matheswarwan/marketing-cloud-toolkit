<script setup>
// Sending > Sends (user, 2026-11-10): one email send by its JobID, or the sends of the
// last days, with SFMC's numbers (targeted, sent, delivered, bounces, opens, clicks,
// unsubscribes, exclusions). SOAP Send. Read-only.
// ?q=<JobID> opens one send (links from Subscriber lookup, user, 2026-11-10).
// Details (user, 2026-11-16): the lists a send went to, messages not sent and why, and its
// unsubscribes (components/sending/SendDetails.vue); open for a JobID search, or Details.
import { computed, ref } from 'vue'
import { Loader2, Search } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import SendDetails from '@/components/sending/SendDetails.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchSends } from '@/utils/messagingApi.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const jobId = ref('')
const days = ref(30)
const list = ref(null)
const shown = ref('')
const busy = ref(false)
const error = ref(null)
const details = ref(null) // { jobId, emailName }
async function run(byJob) {
  details.value = null
  busy.value = true
  error.value = null
  try {
    if (byJob) {
      const id = jobId.value.trim()
      if (!/^\d+$/.test(id)) { error.value = 'A JobID is a number.'; return }
      list.value = await fetchSends(stack.value, { jobId: id })
      shown.value = `JobID ${id}`
      if (list.value.length === 1) details.value = { jobId: list.value[0].jobId, emailName: list.value[0].emailName }
    } else {
      const n = Math.min(Math.max(Math.floor(Number(days.value)) || 30, 1), 365)
      list.value = await fetchSends(stack.value, { since: new Date(Date.now() - n * 86400000).toISOString().slice(0, 19) })
      shown.value = `Sends in the last ${n} ${n === 1 ? 'day' : 'days'}`
    }
  } catch (e) { error.value = searchError(e, 'read the sends') } finally { busy.value = false }
}
let fromLink = false
useRouteSearch('/sends', (q) => { fromLink = true; jobId.value = String(q).trim(); whenStack(() => run(true)) })
whenStack(() => { if (!fromLink) run(false) })

const pct = (a, b) => (a != null && b ? `${Math.round((a / b) * 1000) / 10}%` : '')
const rows = computed(() => (list.value || []).map((s) => ({
  ...s, id: s.jobId, sentAt: formatDateTime(s.sentDate), sentCount: s.sent, deliveryRate: pct(s.delivered, s.sent), openRate: pct(s.uniqueOpens, s.delivered), clickRate: pct(s.uniqueClicks, s.delivered),
  bounces: (s.hardBounces || 0) + (s.softBounces || 0) + (s.otherBounces || 0),
})))
const columns = [
  { key: 'jobId', label: 'JobID' }, { key: 'emailName', label: 'Email' }, { key: 'subject', label: 'Subject', hidden: true }, { key: 'sentAt', label: 'Sent on' }, { key: 'status', label: 'Status' },
  { key: 'targeted', label: 'Targeted', hidden: true }, { key: 'sentCount', label: 'Sent' }, { key: 'delivered', label: 'Delivered' }, { key: 'deliveryRate', label: 'Delivery' },
  { key: 'uniqueOpens', label: 'Unique opens' }, { key: 'openRate', label: 'Open rate' }, { key: 'uniqueClicks', label: 'Unique clicks' }, { key: 'clickRate', label: 'Click rate', hidden: true },
  { key: 'bounces', label: 'Bounces' }, { key: 'hardBounces', label: 'Hard', hidden: true }, { key: 'softBounces', label: 'Soft', hidden: true }, { key: 'otherBounces', label: 'Other', hidden: true },
  { key: 'unsubscribes', label: 'Unsubscribes' }, { key: 'errored', label: 'Errored', hidden: true }, { key: 'excluded', label: 'Excluded', hidden: true },
  { key: 'existingUnsubscribes', label: 'Already unsubscribed', hidden: true }, { key: 'existingUndeliverables', label: 'Already undeliverable', hidden: true },
  { key: 'duplicates', label: 'Duplicates', hidden: true }, { key: 'invalidAddresses', label: 'Invalid addresses', hidden: true }, { key: 'missingAddresses', label: 'Missing addresses', hidden: true },
  { key: 'fromName', label: 'From name', hidden: true }, { key: 'fromAddress', label: 'From address', hidden: true }, { key: 'emailId', label: 'Email ID', hidden: true },
]
const tableRows = rows
const getDoc = () => ({ title: shown.value || 'Sends', blocks: [{ type: 'table', columns: columns.map((c) => c.label), rows: tableRows.value.map((r) => columns.map((c) => String(r[c.key] ?? ''))) }] })
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Sends</h1>
      <span class="text-xs text-muted-foreground">Email sends and SFMC's numbers for each (Email Studio's tracking totals). Read only.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="sends" :disabled="!rows.length" />
    </div>
    <div class="flex flex-wrap items-center gap-3 text-xs">
      <form class="flex items-center gap-1.5" @submit.prevent="run(true)">
        <input v-model="jobId" aria-label="JobID" placeholder="JobID" inputmode="numeric" class="h-8 w-32 rounded-md border border-border bg-background px-2" />
        <Button type="submit" size="sm" class="gap-1" :disabled="busy || !jobId.trim()" data-sends-job><Search class="h-3.5 w-3.5" /> Find</Button>
      </form>
      <span class="text-muted-foreground">or</span>
      <form class="flex items-center gap-1.5" @submit.prevent="run(false)">
        <span>Sends in the last</span>
        <input v-model.number="days" type="number" min="1" max="365" aria-label="Days" class="h-8 w-16 rounded-md border border-border bg-background px-2" />
        <span>days</span>
        <Button type="submit" variant="outline" size="sm" :disabled="busy">Show</Button>
      </form>
      <Loader2 v-if="busy" class="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
    <p v-if="typeof error === 'string' && error.startsWith('A JobID')" class="text-xs text-red-600">{{ error }}</p>
    <SfmcErrorNotice v-else-if="error" :error="error" :retrying="busy" @retry="run(false)" />
    <section v-if="list" class="rounded-lg border border-border bg-card">
      <div class="px-3 py-2 border-b border-border text-xs">{{ shown }}: {{ rows.length }} {{ rows.length === 1 ? 'send' : 'sends' }}. Opens and clicks are unique, rates against delivered.</div>
      <DataTable :columns="columns" :rows="tableRows" storage-key="sends" empty-text="No sends found.">
        <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
        <template #cell-jobId="{ row }">
          <span class="inline-flex items-center gap-1.5">{{ row.jobId }}
            <button type="button" class="text-primary hover:underline text-[11px]" :aria-pressed="details?.jobId === row.jobId" :data-send-details-open="row.jobId" @click="details = { jobId: row.jobId, emailName: row.emailName }">Details</button></span>
        </template>
      </DataTable>
    </section>
    <SendDetails v-if="details" :job-id="details.jobId" :email-name="details.emailName" @close="details = null" />
  </div>
</template>
