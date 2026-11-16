<script setup>
// One send's details (user, 2026-11-16; idea from VeLens's Send Details): the lists it went
// to with each list's numbers, the messages not sent and SFMC's reason, and who
// unsubscribed from it. SOAP ListSend, NotSentEvent, UnsubEvent (utils/sendEvents.js).
// Each part shows on its own; one SFMC refuses says so and the others still show.
import { computed, ref, watch } from 'vue'
import { Loader2, X } from 'lucide-vue-next'
import DataTable from '@/components/results/DataTable.vue'
import { useStack } from '@/composables/useStack.js'
import { fetchSendDetails } from '@/utils/sendEvents.js'
import { formatDateTime } from '@/utils/format.js'

const props = defineProps({ jobId: { type: [Number, String], required: true }, emailName: { type: String, default: '' } })
const emit = defineEmits(['close'])
const { stack } = useStack()
const busy = ref(false)
const error = ref('')
const d = ref(null)
let seq = 0

async function load() {
  const id = ++seq
  busy.value = true
  error.value = ''
  d.value = null
  try {
    const r = await fetchSendDetails(stack.value, props.jobId)
    if (id === seq) d.value = r
  } catch (e) { if (id === seq) error.value = e.message } finally { if (id === seq) busy.value = false }
}
watch(() => props.jobId, load, { immediate: true })

const listColumns = [
  { key: 'listName', label: 'List' }, { key: 'listId', label: 'List ID', hidden: true }, { key: 'sent', label: 'Sent' }, { key: 'delivered', label: 'Delivered' },
  { key: 'uniqueOpens', label: 'Unique opens' }, { key: 'uniqueClicks', label: 'Unique clicks' }, { key: 'bounces', label: 'Bounces' }, { key: 'unsubscribes', label: 'Unsubscribes' },
  { key: 'existingUnsubscribes', label: 'Already unsubscribed' }, { key: 'existingUndeliverables', label: 'Already undeliverable' }, { key: 'duplicates', label: 'Duplicates', hidden: true },
  { key: 'invalidAddresses', label: 'Invalid addresses', hidden: true }, { key: 'missingAddresses', label: 'Missing addresses', hidden: true },
]
const listRows = computed(() => (d.value?.lists.rows || []).map((r, i) => ({ ...r, id: `${r.listId}-${i}` })))
const notSentColumns = [{ key: 'when', label: 'When' }, { key: 'subscriberKey', label: 'Subscriber key' }, { key: 'eventType', label: 'Reason' }, { key: 'listId', label: 'List ID', hidden: true }]
const notSentRows = computed(() => (d.value?.notSent.rows || []).map((r, i) => ({ ...r, id: i, when: formatDateTime(r.eventDate) })))
const unsubColumns = [{ key: 'when', label: 'When' }, { key: 'subscriberKey', label: 'Subscriber key' }, { key: 'scope', label: 'From' }]
const unsubRows = computed(() => (d.value?.unsubscribes.rows || []).map((r, i) => ({ ...r, id: i, when: formatDateTime(r.eventDate), scope: r.master ? 'Everything' : 'The list' })))
</script>

<template>
  <section class="rounded-lg border border-primary/40 bg-card" :aria-label="`Details of JobID ${jobId}`" data-send-details>
    <div class="px-3 py-2 border-b border-border flex items-center gap-2 text-sm">
      <span class="font-semibold">JobID {{ jobId }}</span><span v-if="emailName" class="text-muted-foreground truncate">{{ emailName }}</span>
      <Loader2 v-if="busy" class="h-4 w-4 animate-spin text-muted-foreground" />
      <button type="button" class="ml-auto p-1 rounded hover:bg-accent" aria-label="Close the details" @click="emit('close')"><X class="h-4 w-4" /></button>
    </div>
    <div class="p-3 space-y-4 text-xs">
      <p v-if="error" class="text-red-600 dark:text-red-400">Could not read the details: {{ error }}</p>
      <template v-if="d">
        <div class="space-y-1.5">
          <div class="text-sm font-semibold">Lists it went to</div>
          <p v-if="d.lists.error" class="text-red-600 dark:text-red-400">{{ d.lists.error }}</p>
          <DataTable v-else :columns="listColumns" :rows="listRows" storage-key="send-details-lists" empty-text="No list: sent to a data extension or by a triggered send." />
        </div>
        <div class="space-y-1.5">
          <div class="text-sm font-semibold">Not sent <span class="font-normal text-muted-foreground">({{ d.notSent.rows?.length ?? '?' }})</span></div>
          <p v-if="d.notSent.error" class="text-red-600 dark:text-red-400">{{ d.notSent.error }}</p>
          <template v-else>
            <ul v-if="d.notSentByType?.length" class="flex flex-wrap gap-1.5">
              <li v-for="g in d.notSentByType" :key="g.eventType" class="rounded-full bg-muted px-2.5 py-1">{{ g.eventType }}: <strong>{{ g.count.toLocaleString() }}</strong></li>
            </ul>
            <DataTable :columns="notSentColumns" :rows="notSentRows" storage-key="send-details-notsent" empty-text="Every targeted subscriber was sent to." />
          </template>
        </div>
        <div class="space-y-1.5">
          <div class="text-sm font-semibold">Unsubscribed from this send <span class="font-normal text-muted-foreground">({{ d.unsubscribes.rows?.length ?? '?' }})</span></div>
          <p v-if="d.unsubscribes.error" class="text-red-600 dark:text-red-400">{{ d.unsubscribes.error }}</p>
          <DataTable v-else :columns="unsubColumns" :rows="unsubRows" storage-key="send-details-unsubs" empty-text="Nobody unsubscribed from this send." />
        </div>
      </template>
    </div>
  </section>
</template>
