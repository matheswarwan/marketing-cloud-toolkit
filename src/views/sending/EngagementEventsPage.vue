<script setup>
// Sending > Engagement events (user, 2026-11-16; idea from VeLens's Engagement Hub): what
// subscribers did lately across the business unit: unsubscribes (from everything or one
// list), forwards to a friend, forward opt-ins and inbound SMS. SOAP UnsubEvent,
// ForwardedEmailEvent, ForwardedEmailOptInEvent, SMSMOEvent (utils/sendEvents.js). Read only.
import { computed, reactive, ref } from 'vue'
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchEngagementFeed, ENGAGEMENT_FEEDS, FEED_DAYS, perDay } from '@/utils/sendEvents.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const days = ref(7)
const tab = ref('unsubscribes')
const KINDS = Object.keys(ENGAGEMENT_FEEDS)
const feeds = reactive(Object.fromEntries(KINDS.map((k) => [k, { busy: false, error: null, data: null }])))
let runId = 0

function run() {
  if (!stack.value) return
  const id = ++runId
  for (const k of KINDS) {
    const f = feeds[k]
    Object.assign(f, { busy: true, error: null, data: null })
    fetchEngagementFeed(stack.value, k, { days: days.value })
      .then((data) => { if (id === runId) f.data = data })
      .catch((e) => { if (id === runId) f.error = searchError(e, `read the ${ENGAGEMENT_FEEDS[k].label.toLowerCase()}`) })
      .finally(() => { if (id === runId) f.busy = false })
  }
}
whenStack(run)
function setDays(d) { days.value = d; run() }

const COLUMNS = {
  unsubscribes: [{ key: 'when', label: 'When' }, { key: 'subscriberKey', label: 'Subscriber key' }, { key: 'scope', label: 'From' }, { key: 'sendId', label: 'JobID' }],
  forwards: [{ key: 'when', label: 'When' }, { key: 'subscriberKey', label: 'Forwarded by' }, { key: 'sendId', label: 'JobID' }],
  optins: [{ key: 'when', label: 'When' }, { key: 'optInKey', label: 'New subscriber' }, { key: 'subscriberKey', label: 'Forwarded by' }, { key: 'sendId', label: 'JobID' }],
  sms: [{ key: 'when', label: 'When' }, { key: 'moCode', label: 'Message (keyword)' }, { key: 'carrier', label: 'Carrier' }],
}
const NOTES = {
  unsubscribes: 'From everything (All Subscribers) or from the list the email went to.',
  forwards: 'Forward to a Friend: people who sent an email on through SFMC\'s forward page.',
  optins: 'People who subscribed from a forwarded email.',
  sms: 'Messages people texted to your codes. SFMC gives the keyword or text, the date and the carrier here; the phone number is in MobileConnect.',
}
const rows = computed(() => (feeds[tab.value].data?.rows || []).map((r, i) => ({ ...r, id: i, when: formatDateTime(r.eventDate), scope: r.master ? 'Everything' : 'The list' })))
const bars = computed(() => {
  const d = perDay(feeds[tab.value].data?.rows || [])
  const max = Math.max(1, ...d.map((x) => x.count))
  return d.map((x) => ({ ...x, h: Math.max(4, Math.round((x.count / max) * 48)) }))
})
const busy = computed(() => KINDS.some((k) => feeds[k].busy))
const getDoc = () => ({
  title: `Engagement events, last ${days.value} ${days.value === 1 ? 'day' : 'days'}`,
  blocks: KINDS.flatMap((k) => [
    { type: 'h', level: 2, text: ENGAGEMENT_FEEDS[k].label },
    { type: 'table', columns: COLUMNS[k].map((c) => c.label), rows: (feeds[k].data?.rows || []).map((r) => COLUMNS[k].map((c) => String(c.key === 'when' ? formatDateTime(r.eventDate) : c.key === 'scope' ? (r.master ? 'Everything' : 'The list') : r[c.key] ?? ''))) },
  ]),
})
</script>

<template>
  <div class="p-4 space-y-4 max-w-6xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Engagement events</h1>
      <span class="text-xs text-muted-foreground">Unsubscribes, forwards and inbound SMS in this business unit. Read only.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="engagement-events" :disabled="busy" />
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span>Last</span>
      <div class="flex rounded-full border border-border p-0.5" role="group" aria-label="How far back">
        <button v-for="d in FEED_DAYS" :key="d" type="button" class="h-7 px-3 rounded-full" :aria-pressed="days === d" :class="days === d ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'" @click="setDays(d)">{{ d === 1 ? '24 hours' : `${d} days` }}</button>
      </div>
      <Button size="sm" variant="ghost" class="gap-1" :disabled="busy" @click="run"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>

    <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Event type">
      <button v-for="k in KINDS" :key="k" type="button" role="tab" :aria-selected="tab === k" class="h-8 px-3 rounded-full border text-xs inline-flex items-center gap-1.5" :data-feed-tab="k"
        :class="tab === k ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'" @click="tab = k">
        {{ ENGAGEMENT_FEEDS[k].label }}
        <Loader2 v-if="feeds[k].busy" class="h-3 w-3 animate-spin" />
        <span v-else-if="feeds[k].data" class="tabular-nums font-semibold">{{ feeds[k].data.rows.length.toLocaleString() }}{{ feeds[k].data.capped ? '+' : '' }}</span>
        <span v-else-if="feeds[k].error">?</span>
      </button>
    </div>

    <section class="rounded-lg border border-border bg-card" role="tabpanel" :aria-label="ENGAGEMENT_FEEDS[tab].label">
      <div class="p-3 space-y-3">
        <p class="text-xs text-muted-foreground">{{ NOTES[tab] }}</p>
        <SfmcErrorNotice v-if="feeds[tab].error" :error="feeds[tab].error" :retrying="feeds[tab].busy" @retry="run" />
        <p v-if="feeds[tab].data?.capped" class="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle class="h-3.5 w-3.5" /> More events than shown: only the newest {{ feeds[tab].data.rows.length.toLocaleString() }} were read. Pick a shorter period.</p>
        <div v-if="bars.length > 1" class="flex items-end gap-1 h-14" role="img" :aria-label="`${ENGAGEMENT_FEEDS[tab].label} per day`" data-per-day>
          <div v-for="b in bars" :key="b.day" class="flex-1 min-w-[4px] max-w-[24px] rounded-t bg-primary/60" :style="{ height: `${b.h}px` }" :title="`${b.day}: ${b.count.toLocaleString()}`" />
        </div>
        <DataTable v-if="feeds[tab].data" :columns="COLUMNS[tab]" :rows="rows" :storage-key="`engagement-${tab}`" :empty-text="`No ${ENGAGEMENT_FEEDS[tab].label.toLowerCase()} in this period.`">
          <template #cell-sendId="{ row }"><RouterLink v-if="row.sendId != null" :to="`/sends?q=${row.sendId}`" class="text-primary hover:underline">{{ row.sendId }}</RouterLink></template>
        </DataTable>
      </div>
    </section>
  </div>
</template>
