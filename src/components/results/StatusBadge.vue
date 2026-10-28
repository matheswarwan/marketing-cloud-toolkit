<script setup>
// Coloured pill for SFMC status values (from Automation Viewer's sfmcStatusBadge), with
// an icon per status (feedback #123). `automation` turns SFMC's numeric automation
// status codes into names.
import { computed } from 'vue'
import { Loader2, CircleCheck, CircleX, CirclePause, CircleStop, CalendarClock, Clock, Zap, Circle, PencilLine } from 'lucide-vue-next'
import { automationStatusName } from '@/utils/watches.js'

const props = defineProps({
  status: { type: [String, Number], default: '' },
  automation: { type: Boolean, default: false },
})
const text = computed(() => (props.automation ? automationStatusName(props.status) : props.status))
const s = computed(() => String(text.value || '').toLowerCase())
const tone = computed(() => {
  if (/error|fail/.test(s.value)) return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
  if (/paused|stopped|draft|unpublished|inactive|building/.test(s.value)) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  if (/running|scheduled|queued|ready|awaiting/.test(s.value)) return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
  if (/complete|published|active|success/.test(s.value)) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  return 'bg-muted text-muted-foreground'
})
const icon = computed(() => {
  const v = s.value
  if (/error|fail/.test(v)) return CircleX
  if (/(?:^running)|executing|in ?progress/.test(v)) return Loader2
  if (/inactive|stopped/.test(v)) return CircleStop
  if (/paused/.test(v)) return CirclePause
  if (/draft|building|unpublished/.test(v)) return PencilLine
  if (/scheduled/.test(v)) return CalendarClock
  if (/awaiting|trigger/.test(v)) return Zap
  if (/queued|waiting/.test(v)) return Clock
  if (/complete|published|active|success/.test(v)) return CircleCheck
  if (/ready/.test(v)) return Circle
  return null
})
const spins = computed(() => icon.value === Loader2)
</script>

<template>
  <span v-if="text !== '' && text != null" class="inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-medium whitespace-nowrap" :class="tone">
    <component :is="icon" v-if="icon" class="h-3 w-3 shrink-0" :class="spins ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />{{ text }}
  </span>
  <span v-else class="text-muted-foreground">—</span>
</template>
