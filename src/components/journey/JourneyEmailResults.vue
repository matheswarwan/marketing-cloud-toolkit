<script setup>
// Email results of one journey version (user, 2026-11-16; idea from VeLens's journey
// panel): all-time sent, delivered, unique opens and clicks, bounces and opt-outs for each
// email step, from the triggered send behind it (SOAP TriggeredSendSummary,
// utils/messagingApi.js fetchJourneyEmailResults). Read only; loads when opened.
import { computed, ref, watch } from 'vue'
import { Loader2, ChevronDown, ChevronRight, Mail } from 'lucide-vue-next'
import { fetchJourneyEmailResults, journeyEmailSteps } from '@/utils/messagingApi.js'

const props = defineProps({ stack: { type: String, default: '' }, journey: { type: Object, required: true } })
const open = ref(false)
const busy = ref(false)
const error = ref('')
const rows = ref(null)
const steps = computed(() => journeyEmailSteps(props.journey))
let seq = 0

async function load() {
  const id = ++seq
  busy.value = true
  error.value = ''
  try {
    const r = await fetchJourneyEmailResults(props.stack, props.journey)
    if (id === seq) rows.value = r
  } catch (e) { if (id === seq) error.value = e.message } finally { if (id === seq) busy.value = false }
}
watch(() => [props.journey.id, props.journey.version], () => { rows.value = null; if (open.value) load() })
function toggle() { open.value = !open.value; if (open.value && !rows.value && !busy.value) load() }

const pct = (a, b) => (a != null && b ? `${Math.round((a / b) * 1000) / 10}%` : '')
const fmt = (n) => (n == null ? '' : n.toLocaleString())
</script>

<template>
  <section v-if="steps.length" class="rounded-lg border border-border bg-card text-xs" data-journey-email-results>
    <button type="button" class="w-full flex items-center gap-1.5 px-3 py-2 font-semibold text-sm" :aria-expanded="open" @click="toggle">
      <ChevronDown v-if="open" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /><Mail class="h-4 w-4 text-muted-foreground" /> Email results
      <span class="font-normal text-xs text-muted-foreground">{{ steps.length }} email {{ steps.length === 1 ? 'step' : 'steps' }} in version {{ journey.version }}, all time</span>
      <Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" />
    </button>
    <div v-if="open" class="border-t border-border p-3 space-y-2">
      <p v-if="error" class="text-red-600 dark:text-red-400">Could not read the results: {{ error }}</p>
      <div v-if="rows" class="overflow-x-auto">
        <table class="w-full">
          <thead><tr class="text-left text-muted-foreground"><th class="py-1 pr-3 font-medium">Email step</th><th class="py-1 pr-3 font-medium text-right">Sent</th><th class="py-1 pr-3 font-medium text-right">Delivered</th>
            <th class="py-1 pr-3 font-medium text-right">Unique opens</th><th class="py-1 pr-3 font-medium text-right">Unique clicks</th><th class="py-1 pr-3 font-medium text-right">Bounces</th><th class="py-1 pr-3 font-medium text-right">Opt-outs</th><th class="py-1 font-medium text-right">Not sent (error)</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" class="border-t border-border" :data-email-step="r.key">
              <td class="py-1.5 pr-3"><div class="font-medium">{{ r.name }}</div><div v-if="r.emailName && r.emailName !== r.name" class="text-muted-foreground">{{ r.emailName }}</div></td>
              <template v-if="r.counts">
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.sent) }}</td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.delivered) }}</td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.opens) }} <span class="text-muted-foreground">{{ pct(r.counts.opens, r.counts.delivered) }}</span></td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.clicks) }} <span class="text-muted-foreground">{{ pct(r.counts.clicks, r.counts.delivered) }}</span></td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.bounces) }}</td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{{ fmt(r.counts.optOuts) }}</td>
                <td class="py-1.5 text-right tabular-nums" :class="r.counts.notSentError ? 'text-red-600 dark:text-red-400 font-semibold' : ''">{{ fmt(r.counts.notSentError) }}</td>
              </template>
              <td v-else colspan="7" class="py-1.5 text-muted-foreground italic">No numbers yet: this step has not sent, or its triggered send is not in this business unit.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-muted-foreground">Since this version was published, from the triggered send behind each email step. Opens and clicks are unique; rates are against delivered (sent minus bounces).</p>
    </div>
  </section>
</template>
