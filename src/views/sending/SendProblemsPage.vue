<script setup>
// Sending > Send problems (user, 2026-11-16; idea from VeLens's Error Log): one place for
// "what went wrong with sending lately": bounces grouped by reason and by send, messages
// not sent and why, triggered sends that need a look, and imports with errors. SOAP
// BounceEvent, NotSentEvent (utils/sendEvents.js), TriggeredSendDefinition/Summary
// (messagingApi.js), ImportResultsSummary (setupApi.js). Each card loads on its own.
// Read only.
import { computed, reactive, ref } from 'vue'
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchBounceFeed, fetchNotSentFeed, groupBounces, bouncesBySend, groupNotSent, FEED_DAYS } from '@/utils/sendEvents.js'
import { fetchTriggeredSends, triggeredSendFlags } from '@/utils/messagingApi.js'
import { fetchImportResults, importResultFlags } from '@/utils/setupApi.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const days = ref(7)
const blank = () => ({ busy: false, error: null, data: null })
const cards = reactive({ bounces: blank(), notSent: blank(), triggered: blank(), imports: blank() })
let runId = 0

async function load(card, what, fn, id) {
  const c = cards[card]
  Object.assign(c, { busy: true, error: null, data: null })
  try {
    const data = await fn()
    if (id === runId) c.data = data
  } catch (e) {
    if (id === runId) c.error = searchError(e, what)
  } finally { if (id === runId) c.busy = false }
}
function run() {
  if (!stack.value) return
  const id = ++runId
  const s = stack.value
  const d = days.value
  load('bounces', 'read the bounces', () => fetchBounceFeed(s, { days: d }), id)
  load('notSent', 'read the messages not sent', () => fetchNotSentFeed(s, { days: d }), id)
  load('triggered', 'read the triggered sends', async () => (await fetchTriggeredSends(s)).map((t) => ({ ...t, flags: triggeredSendFlags(t) })).filter((t) => t.flags.length), id)
  load('imports', 'read the import results', async () => (await fetchImportResults(s, { days: Math.max(d, 1) })).map((r) => ({ ...r, flags: importResultFlags(r) })).filter((r) => r.flags.length), id)
}
whenStack(run)
function setDays(d) { days.value = d; run() }

const busy = computed(() => Object.values(cards).some((c) => c.busy))
const bounceGroups = computed(() => (cards.bounces.data ? groupBounces(cards.bounces.data.rows) : []))
const bounceSends = computed(() => (cards.bounces.data ? bouncesBySend(cards.bounces.data.rows).slice(0, 10) : []))
const hardCount = computed(() => (cards.bounces.data?.rows || []).filter((r) => /hard/i.test(`${r.category} ${r.type}`)).length)
const notSentGroups = computed(() => (cards.notSent.data ? groupNotSent(cards.notSent.data.rows) : []))
const tiles = computed(() => [
  { id: 'bounces', label: 'Bounces', value: cards.bounces.data?.rows.length, sub: cards.bounces.data ? `${hardCount.value.toLocaleString()} hard` : '', capped: cards.bounces.data?.capped },
  { id: 'notSent', label: 'Not sent', value: cards.notSent.data?.rows.length, capped: cards.notSent.data?.capped },
  { id: 'triggered', label: 'Triggered sends to look at', value: cards.triggered.data?.length },
  { id: 'imports', label: 'Imports with problems', value: cards.imports.data?.length },
])

const groupColumns = [
  { key: 'category', label: 'Category' }, { key: 'smtpCode', label: 'SMTP code' }, { key: 'count', label: 'Bounces' },
  { key: 'subscribers', label: 'Subscribers' }, { key: 'sends', label: 'Sends' }, { key: 'reason', label: 'Example reason' }, { key: 'lastAt', label: 'Latest' },
]
const groupRows = computed(() => bounceGroups.value.map((g, i) => ({ ...g, id: i, lastAt: formatDateTime(g.last) })))
const notSentColumns = [{ key: 'eventDate', label: 'When' }, { key: 'subscriberKey', label: 'Subscriber key' }, { key: 'eventType', label: 'Reason' }, { key: 'sendId', label: 'JobID' }, { key: 'listId', label: 'List ID', hidden: true }, { key: 'triggeredSendId', label: 'Triggered send', hidden: true }]
const notSentRows = computed(() => (cards.notSent.data?.rows || []).map((r, i) => ({ ...r, id: i, eventDate: formatDateTime(r.eventDate) })))
const tsColumns = [{ key: 'name', label: 'Triggered send' }, { key: 'status', label: 'Status' }, { key: 'flagText', label: 'What to look at' }, { key: 'key', label: 'Key', hidden: true }]
const tsRows = computed(() => (cards.triggered.data || []).map((t) => ({ ...t, id: t.key, flagText: t.flags.join('; ') })))
const importColumns = [{ key: 'name', label: 'Import' }, { key: 'startAt', label: 'Started' }, { key: 'status', label: 'Status' }, { key: 'flagText', label: 'What to look at' }, { key: 'errors', label: 'Errors' }]
const importRows = computed(() => (cards.imports.data || []).map((r, i) => ({ ...r, id: i, startAt: formatDateTime(r.start), flagText: r.flags.join('; ') })))

const bounceDetailColumns = ['When', 'Subscriber key', 'JobID', 'Category', 'Type', 'SMTP code', 'SMTP reason']
const getDoc = () => ({
  title: `Send problems, last ${days.value} ${days.value === 1 ? 'day' : 'days'}`,
  blocks: [
    { type: 'h', level: 2, text: 'Bounces by reason' },
    { type: 'table', columns: groupColumns.map((c) => c.label), rows: groupRows.value.map((r) => groupColumns.map((c) => String(r[c.key] ?? ''))) },
    { type: 'h', level: 2, text: 'Every bounce' },
    { type: 'table', columns: bounceDetailColumns, rows: (cards.bounces.data?.rows || []).map((r) => [formatDateTime(r.eventDate), r.subscriberKey, String(r.sendId ?? ''), r.category, r.type, r.smtpCode, r.smtpReason]) },
    { type: 'h', level: 2, text: 'Not sent' },
    { type: 'table', columns: notSentColumns.map((c) => c.label), rows: notSentRows.value.map((r) => notSentColumns.map((c) => String(r[c.key] ?? ''))) },
    { type: 'h', level: 2, text: 'Triggered sends to look at' },
    { type: 'table', columns: tsColumns.map((c) => c.label), rows: tsRows.value.map((r) => tsColumns.map((c) => String(r[c.key] ?? ''))) },
    { type: 'h', level: 2, text: 'Imports with problems' },
    { type: 'table', columns: importColumns.map((c) => c.label), rows: importRows.value.map((r) => importColumns.map((c) => String(r[c.key] ?? ''))) },
  ],
})
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Send problems</h1>
      <span class="text-xs text-muted-foreground">Bounces, messages not sent, triggered sends and imports that need a look, in this business unit. Read only.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="send-problems" :disabled="busy" />
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span>Last</span>
      <div class="flex rounded-full border border-border p-0.5" role="group" aria-label="How far back">
        <button v-for="d in FEED_DAYS" :key="d" type="button" class="h-7 px-3 rounded-full" :aria-pressed="days === d" :class="days === d ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'" @click="setDays(d)">{{ d === 1 ? '24 hours' : `${d} days` }}</button>
      </div>
      <Button size="sm" variant="ghost" class="gap-1" :disabled="busy" @click="run"><Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><RefreshCw v-else class="h-3.5 w-3.5" /> Refresh</Button>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2" data-problem-tiles>
      <a v-for="t in tiles" :key="t.id" :href="`#problem-${t.id}`" class="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent" :data-tile="t.id">
        <div class="text-xs text-muted-foreground">{{ t.label }}</div>
        <div class="text-xl font-bold tabular-nums" :class="t.value ? 'text-foreground' : 'text-muted-foreground'">
          <Loader2 v-if="cards[t.id].busy" class="h-4 w-4 animate-spin inline" /><template v-else-if="cards[t.id].error">?</template><template v-else>{{ (t.value ?? 0).toLocaleString() }}{{ t.capped ? '+' : '' }}</template>
        </div>
        <div v-if="t.sub" class="text-[11px] text-muted-foreground">{{ t.sub }}</div>
      </a>
    </div>

    <section id="problem-bounces" class="rounded-lg border border-border bg-card" aria-label="Bounces">
      <div class="px-3 py-2 border-b border-border text-sm font-semibold">Bounces by reason</div>
      <div class="p-3 space-y-3">
        <SfmcErrorNotice v-if="cards.bounces.error" :error="cards.bounces.error" :retrying="cards.bounces.busy" @retry="run" />
        <p v-if="cards.bounces.data?.capped" class="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle class="h-3.5 w-3.5" /> More bounces than shown: only the newest {{ cards.bounces.data.rows.length.toLocaleString() }} were read. Pick a shorter period.</p>
        <DataTable v-if="cards.bounces.data" :columns="groupColumns" :rows="groupRows" storage-key="send-problems-bounces" empty-text="No bounces in this period." />
        <div v-if="bounceSends.length" class="text-xs space-y-1">
          <div class="font-semibold">Sends with the most bounces</div>
          <ul class="flex flex-wrap gap-1.5">
            <li v-for="b in bounceSends" :key="b.sendId"><RouterLink :to="`/sends?q=${b.sendId}`" class="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 hover:bg-accent">JobID {{ b.sendId }}: {{ b.count.toLocaleString() }}<template v-if="b.hard"> ({{ b.hard }} hard)</template></RouterLink></li>
          </ul>
        </div>
      </div>
    </section>

    <section id="problem-notSent" class="rounded-lg border border-border bg-card" aria-label="Not sent">
      <div class="px-3 py-2 border-b border-border text-sm font-semibold">Not sent</div>
      <div class="p-3 space-y-2">
        <SfmcErrorNotice v-if="cards.notSent.error" :error="cards.notSent.error" :retrying="cards.notSent.busy" @retry="run" />
        <p class="text-xs text-muted-foreground">Messages SFMC did not send, such as to unsubscribed, held or excluded people. The reason is SFMC's own event type.</p>
        <ul v-if="notSentGroups.length" class="flex flex-wrap gap-1.5 text-xs">
          <li v-for="g in notSentGroups" :key="g.eventType" class="rounded-full bg-muted px-2.5 py-1">{{ g.eventType }}: <strong>{{ g.count.toLocaleString() }}</strong></li>
        </ul>
        <DataTable v-if="cards.notSent.data" :columns="notSentColumns" :rows="notSentRows" storage-key="send-problems-notsent" empty-text="Nothing was held back in this period." />
      </div>
    </section>

    <section id="problem-triggered" class="rounded-lg border border-border bg-card" aria-label="Triggered sends">
      <div class="px-3 py-2 border-b border-border text-sm font-semibold flex items-center gap-2">Triggered sends to look at <RouterLink to="/triggered-sends" class="ml-auto text-xs font-normal text-primary hover:underline">All triggered sends</RouterLink></div>
      <div class="p-3 space-y-2">
        <SfmcErrorNotice v-if="cards.triggered.error" :error="cards.triggered.error" :retrying="cards.triggered.busy" @retry="run" />
        <DataTable v-if="cards.triggered.data" :columns="tsColumns" :rows="tsRows" storage-key="send-problems-ts" empty-text="No triggered send has a queue or errors.">
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
        </DataTable>
      </div>
    </section>

    <section id="problem-imports" class="rounded-lg border border-border bg-card" aria-label="Imports">
      <div class="px-3 py-2 border-b border-border text-sm font-semibold flex items-center gap-2">Imports with problems <RouterLink to="/import-results" class="ml-auto text-xs font-normal text-primary hover:underline">All import results</RouterLink></div>
      <div class="p-3 space-y-2">
        <SfmcErrorNotice v-if="cards.imports.error" :error="cards.imports.error" :retrying="cards.imports.busy" @retry="run" />
        <DataTable v-if="cards.imports.data" :columns="importColumns" :rows="importRows" storage-key="send-problems-imports" empty-text="No import had errors in this period.">
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
        </DataTable>
      </div>
    </section>
  </div>
</template>
