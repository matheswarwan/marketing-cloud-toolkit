<script setup>
// Contacts > Subscriber lookup (user, 2026-11-10): one subscriber by key or email address,
// with a card per source: All Subscribers (status), lists, bounces, unsubscribes and recent
// sends, plus a plain summary of why the person may not get email. SOAP Subscriber,
// ListSubscriber + List, BounceEvent, UnsubEvent, SentEvent (utils/contactsLookup.js).
// Cards load on their own: one failing shows its error and the others still show. The
// profile attributes SFMC returns are never shown. Read-only: nothing is changed in SFMC.
// Every business unit (user, 2026-11-16; idea from VeLens): the same person in each BU
// this login can see, with their status there (SOAP Subscriber with QueryAllAccounts).
import { computed, reactive, ref } from 'vue'
import { Loader2, Search, Info } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import DataTable from '@/components/results/DataTable.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import StatusBadge from '@/components/results/StatusBadge.vue'
import { useStack, whenStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { searchError } from '@/utils/sfmcErrors.js'
import { fetchBusinessUnits } from '@/utils/setupApi.js'
import {
  fetchSubscriberAcrossBUs, statusSummary,
  looksLikeEmail, fetchSubscribers, fetchListMemberships, fetchBounces, fetchUnsubscribes, fetchRecentSends, whyNoEmail, RECENT_SENDS,
} from '@/utils/contactsLookup.js'
import { formatDateTime } from '@/utils/format.js'

const { stack } = useStack()
const text = ref('')
const mode = ref('auto') // auto | key | email
const searched = ref(null) // { value, byEmail }
const matches = ref([]) // subscribers found by email address
const picked = ref('') // the subscriber key the other cards show

const blank = () => ({ busy: false, error: null, data: null })
const cards = reactive({ subscriber: blank(), lists: blank(), bounces: blank(), unsubs: blank(), sends: blank(), allBUs: blank() })
let runId = 0

const byEmail = computed(() => mode.value === 'email' || (mode.value === 'auto' && looksLikeEmail(text.value)))

async function load(card, what, fn, id) {
  const c = cards[card]
  c.busy = true
  c.error = null
  c.data = null
  try {
    const data = await fn()
    if (id === runId) c.data = data
  } catch (e) {
    if (id === runId) c.error = searchError(e, what)
  } finally { if (id === runId) c.busy = false }
}

const KEY_CARDS = {
  lists: ['read the list memberships', fetchListMemberships],
  bounces: ['read the bounces', fetchBounces],
  unsubs: ['read the unsubscribes', fetchUnsubscribes],
  sends: ['read the recent sends', fetchRecentSends],
}
function loadCard(card, key = picked.value) {
  const [what, fn] = KEY_CARDS[card]
  const s = stack.value
  load(card, what, () => fn(s, key), runId)
}
function loadKeyCards(key) {
  picked.value = key
  for (const card of Object.keys(KEY_CARDS)) loadCard(card, key)
}

async function search() {
  const value = text.value.trim()
  if (!value || !stack.value) return
  const id = ++runId
  const email = byEmail.value
  searched.value = { value, byEmail: email }
  matches.value = []
  picked.value = ''
  for (const k of Object.keys(cards)) Object.assign(cards[k], blank())
  if (!email) loadKeyCards(value) // events and lists are read by key whether or not All Subscribers has the key
  await load('subscriber', 'read All Subscribers', () => fetchSubscribers(stack.value, email ? { email: value } : { key: value }), id)
  if (id !== runId || !email) return
  matches.value = cards.subscriber.data || []
  if (matches.value.length) loadKeyCards(matches.value[0].key)
}

// Every business unit: on request (it reads a row per BU), by the picked key, else by
// what was searched for.
let buNames = null
function loadAllBUs() {
  const s = stack.value
  const by = picked.value ? { key: picked.value } : searched.value?.byEmail ? { email: searched.value.value } : { key: searched.value?.value }
  load('allBUs', 'read the subscriber in every business unit', async () => {
    if (!buNames) buNames = new Map((await fetchBusinessUnits(s).catch(() => [])).map((b) => [b.mid, b.name]))
    return fetchSubscriberAcrossBUs(s, { ...by, buNames })
  }, runId)
}
const buCols = [
  { key: 'businessUnit', label: 'Business unit' }, { key: 'mid', label: 'MID' }, { key: 'status', label: 'Status' }, { key: 'key', label: 'Subscriber key' },
  { key: 'email', label: 'Email address' }, { key: 'unsubscribed', label: 'Unsubscribed', hidden: true }, { key: 'created', label: 'Created', hidden: true },
]
const buRows = computed(() => (cards.allBUs.data || []).map((r, i) => ({ ...r, id: `${r.mid}-${r.key}-${i}`, unsubscribed: formatDateTime(r.unsubscribedDate), created: formatDateTime(r.createdDate) })))
const buSummary = computed(() => (cards.allBUs.data?.length ? statusSummary(cards.allBUs.data) : ''))

// From Ctrl+K (user, 2026-11-16): ?q=<key or email address>.
useRouteSearch('/subscribers', (q) => { text.value = q; whenStack(search) })

function pick(key) {
  if (key === picked.value) return
  for (const k of ['lists', 'bounces', 'unsubs', 'sends']) Object.assign(cards[k], blank())
  runId++
  loadKeyCards(key)
}

const subscriber = computed(() => (cards.subscriber.data || []).find((s) => s.key === picked.value) || (searched.value?.byEmail ? null : cards.subscriber.data?.[0]) || null)
const notFound = computed(() => Array.isArray(cards.subscriber.data) && !cards.subscriber.data.length)
const reasons = computed(() => (searched.value && !cards.subscriber.busy && !cards.subscriber.error ? whyNoEmail({
  subscriber: subscriber.value, notFound: notFound.value,
  lists: cards.lists.data || undefined, bounces: cards.bounces.data || undefined, unsubscribes: cards.unsubs.data || undefined,
}) : []))
const stillLoading = computed(() => Object.values(cards).some((c) => c.busy))

const d = (v) => formatDateTime(v)
const listRows = computed(() => (cards.lists.data || []).map((l) => ({ ...l, id: l.listId, created: d(l.createdDate), unsubscribed: d(l.unsubscribedDate) })))
const bounceRows = computed(() => (cards.bounces.data || []).map((b, i) => ({ ...b, id: i, when: d(b.eventDate) })))
const unsubRows = computed(() => (cards.unsubs.data || []).map((u, i) => ({ ...u, id: i, when: d(u.eventDate), masterText: u.master ? 'Yes' : 'No' })))
const sendRows = computed(() => (cards.sends.data?.rows || []).map((s, i) => ({ ...s, id: i, when: d(s.eventDate) })))

const listCols = [
  { key: 'listName', label: 'List' }, { key: 'status', label: 'Status' }, { key: 'created', label: 'Added' }, { key: 'unsubscribed', label: 'Unsubscribed' },
  { key: 'listType', label: 'Type', hidden: true }, { key: 'classification', label: 'Classification', hidden: true }, { key: 'listId', label: 'List ID', hidden: true },
]
const bounceCols = [
  { key: 'when', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'type', label: 'Type', hidden: true }, { key: 'smtpCode', label: 'SMTP code' },
  { key: 'smtpReason', label: 'SMTP reason' }, { key: 'sendId', label: 'JobID' },
]
const unsubCols = [{ key: 'when', label: 'Date' }, { key: 'masterText', label: 'From everything' }, { key: 'sendId', label: 'JobID' }]
const sendCols = [{ key: 'when', label: 'Date' }, { key: 'sendId', label: 'JobID' }, { key: 'triggeredSendId', label: 'Triggered send ID', hidden: true }]

const table = (title, cols, rows) => [{ type: 'h', level: 2, text: title }, rows.length
  ? { type: 'table', columns: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => String(r[c.key] ?? ''))) }
  : { type: 'p', text: 'None found.' }]
function getDoc() {
  const s = subscriber.value
  return {
    title: `Subscriber ${picked.value || searched.value?.value || ''}`,
    blocks: [
      ...(reasons.value.length ? [{ type: 'h', level: 2, text: 'Why this person may not get email' }, ...reasons.value.map((t) => ({ type: 'p', text: t }))] : []),
      { type: 'h', level: 2, text: 'All Subscribers' },
      s ? { type: 'kv', rows: [['Subscriber key', s.key], ['Email address', s.email], ['Status', s.status], ['Created', d(s.createdDate)], ['Unsubscribed', d(s.unsubscribedDate)], ['Email type', s.emailType], ['Subscriber ID', String(s.id ?? '')]] } : { type: 'p', text: 'Not found.' },
      ...table('Lists', listCols, listRows.value), ...table('Bounces', bounceCols, bounceRows.value),
      ...table('Unsubscribes', unsubCols, unsubRows.value), ...table(`Recent sends (latest ${RECENT_SENDS})`, sendCols, sendRows.value),
    ],
  }
}
</script>

<template>
  <div class="p-4 space-y-4 max-w-7xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Subscriber lookup</h1>
      <span class="text-xs text-muted-foreground">One subscriber's status, lists, bounces, unsubscribes and recent sends in this business unit. Read only.</span>
      <div class="flex-1" />
      <DownloadMenu :get-doc="getDoc" file-name="subscriber" :disabled="!searched || stillLoading" />
    </div>

    <form class="flex flex-wrap items-center gap-2 text-xs" @submit.prevent="search">
      <input v-model="text" aria-label="Subscriber key or email address" placeholder="Subscriber key or email address" class="h-8 w-80 max-w-full rounded-md border border-border bg-background px-2" data-sub-text />
      <div class="flex gap-0.5 border border-border rounded-md p-0.5" role="group" aria-label="Search by">
        <button v-for="[k, l] in [['auto', 'Detect'], ['key', 'Subscriber key'], ['email', 'Email address']]" :key="k" type="button" class="px-2 py-0.5 rounded"
          :class="mode === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-pressed="mode === k" @click="mode = k">{{ l }}</button>
      </div>
      <Button type="submit" size="sm" class="gap-1" :disabled="!text.trim() || !stack" data-sub-search><Search class="h-3.5 w-3.5" /> Look up</Button>
      <span v-if="text.trim()" class="text-muted-foreground">Searching by {{ byEmail ? 'email address' : 'subscriber key' }} (matched exactly).</span>
    </form>

    <template v-if="searched">
      <section class="rounded-lg border border-border bg-card p-3 text-sm space-y-1.5" data-sub-why>
        <h2 class="text-sm font-semibold">Why this person may not get email</h2>
        <div v-if="cards.subscriber.busy" class="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Reading…</div>
        <p v-else-if="cards.subscriber.error" class="text-xs text-muted-foreground">All Subscribers could not be read, so there is no summary.</p>
        <ul v-else-if="reasons.length" class="list-disc pl-5 space-y-1 text-amber-800 dark:text-amber-300">
          <li v-for="r in reasons" :key="r">{{ r }}</li>
        </ul>
        <p v-else class="text-xs">Nothing found that stops sends{{ stillLoading ? ' so far' : '' }}. Check the send's audience, exclusions and the email's suppression lists too.</p>
        <p class="flex items-start gap-1.5 text-xs text-muted-foreground"><Info class="h-3.5 w-3.5 mt-0.5 shrink-0" /> SFMC keeps tracking events (sends, bounces, unsubscribes) for a limited time, about 6 months, so older events are not listed.</p>
      </section>

      <section class="rounded-lg border border-border bg-card" data-sub-card="subscriber">
        <h2 class="px-3 py-2 border-b border-border text-sm font-semibold">All Subscribers</h2>
        <div class="p-3 text-sm">
          <div v-if="cards.subscriber.busy" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading…</div>
          <SfmcErrorNotice v-else-if="cards.subscriber.error" :error="cards.subscriber.error" @retry="search" />
          <p v-else-if="notFound" class="text-muted-foreground">No subscriber with this {{ searched.byEmail ? 'email address' : 'key' }} at All Subscribers.</p>
          <template v-else>
            <div v-if="matches.length > 1" class="mb-3 text-xs">
              <p class="mb-1">{{ matches.length }} subscribers have this email address. The cards below show:</p>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="m in matches" :key="m.key" type="button" class="rounded-full border px-2 py-0.5" :class="m.key === picked ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'" @click="pick(m.key)">{{ m.key }} ({{ m.status }})</button>
              </div>
            </div>
            <dl v-if="subscriber" class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              <dt class="text-muted-foreground">Subscriber key</dt><dd class="break-all">{{ subscriber.key }}</dd>
              <dt class="text-muted-foreground">Email address</dt><dd class="break-all">{{ subscriber.email }}</dd>
              <dt class="text-muted-foreground">Status</dt><dd><StatusBadge :status="subscriber.status" /></dd>
              <dt class="text-muted-foreground">Created</dt><dd>{{ d(subscriber.createdDate) }}</dd>
              <dt class="text-muted-foreground">Unsubscribed</dt><dd>{{ d(subscriber.unsubscribedDate) || 'No' }}</dd>
              <dt class="text-muted-foreground">Email type</dt><dd>{{ subscriber.emailType }}</dd>
              <dt class="text-muted-foreground">Subscriber ID</dt><dd>{{ subscriber.id }}</dd>
            </dl>
          </template>
        </div>
      </section>

      <section class="rounded-lg border border-border bg-card" data-sub-card="allBUs">
        <div class="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-semibold">Every business unit</h2>
          <span v-if="buSummary" class="text-xs text-muted-foreground">{{ buSummary }}</span>
          <Button size="sm" variant="outline" class="ml-auto" :disabled="cards.allBUs.busy" data-sub-all-bus @click="loadAllBUs"><Loader2 v-if="cards.allBUs.busy" class="h-3.5 w-3.5 animate-spin" />{{ cards.allBUs.data ? 'Check again' : 'Check every business unit' }}</Button>
        </div>
        <div class="p-3 text-xs space-y-2">
          <p v-if="!cards.allBUs.data && !cards.allBUs.busy && !cards.allBUs.error" class="text-muted-foreground">Which business units this person is in, and their status in each: useful when you do not know where they live, or when they are unsubscribed in one unit only. Reads one row per business unit your login can see.</p>
          <SfmcErrorNotice v-if="cards.allBUs.error" :error="cards.allBUs.error" @retry="loadAllBUs" />
          <DataTable v-if="cards.allBUs.data" :columns="buCols" :rows="buRows" storage-key="subscriber-all-bus" empty-text="Not found in any business unit this login can see.">
            <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          </DataTable>
        </div>
      </section>

      <p v-if="searched.byEmail && notFound" class="text-xs text-muted-foreground">Lists and tracking events are read by subscriber key, so nothing more can be shown. Try the subscriber key if you know it.</p>

      <template v-for="c in [
        { id: 'lists', title: 'Lists', cols: listCols, rows: listRows, empty: 'Not on any list (other than through data extension sends).' },
        { id: 'bounces', title: 'Bounces', cols: bounceCols, rows: bounceRows, empty: 'No bounces.' },
        { id: 'unsubs', title: 'Unsubscribes', cols: unsubCols, rows: unsubRows, empty: 'No unsubscribe events.' },
        { id: 'sends', title: 'Recent sends', cols: sendCols, rows: sendRows, empty: 'No sends found.' },
      ]" :key="c.id">
        <section v-if="picked" class="rounded-lg border border-border bg-card" :data-sub-card="c.id">
          <h2 class="px-3 py-2 border-b border-border text-sm font-semibold">
            {{ c.title }}
            <span v-if="c.id === 'sends' && cards.sends.data" class="font-normal text-xs text-muted-foreground">
              {{ cards.sends.data.total > RECENT_SENDS ? `latest ${RECENT_SENDS} of ${cards.sends.data.total}` : cards.sends.data.total }}
            </span>
            <span v-else-if="cards[c.id].data" class="font-normal text-xs text-muted-foreground">{{ c.rows.length }}</span>
          </h2>
          <div v-if="cards[c.id].busy" class="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Reading…</div>
          <div v-else-if="cards[c.id].error" class="p-3"><SfmcErrorNotice :error="cards[c.id].error" @retry="loadCard(c.id)" /></div>
          <DataTable v-else-if="cards[c.id].data" :columns="c.cols" :rows="c.rows" :storage-key="`subscriber-${c.id}`" :empty-text="c.empty">
            <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
            <template #cell-sendId="{ row }"><router-link v-if="row.sendId != null" :to="{ path: '/sends', query: { q: String(row.sendId) } }" class="text-primary hover:underline">{{ row.sendId }}</router-link></template>
          </DataTable>
        </section>
      </template>
    </template>
  </div>
</template>
