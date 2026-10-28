<script setup>
// Icon for an automation activity type (feedback #123), by objectTypeId or by name
// ("Query", "SQL Query", "Script", ...). Inline SVG from lucide, which the app already uses.
import { computed } from 'vue'
import { Database, FileCode2, FileInput, FileOutput, ArrowRightLeft, Send, ShieldCheck, Filter, Hourglass, Workflow, Smartphone, MessageSquare, RefreshCw, Users, Cog } from 'lucide-vue-next'
import { activityIconKind } from '@/utils/activityIcons.js'

const props = defineProps({
  type: { type: [Number, String], default: null },
  size: { type: String, default: 'h-3.5 w-3.5' },
})

const ICONS = {
  query: [Database, 'text-sky-600 dark:text-sky-400'],
  script: [FileCode2, 'text-violet-600 dark:text-violet-400'],
  import: [FileInput, 'text-emerald-600 dark:text-emerald-400'],
  extract: [FileOutput, 'text-teal-600 dark:text-teal-400'],
  transfer: [ArrowRightLeft, 'text-cyan-600 dark:text-cyan-400'],
  email: [Send, 'text-orange-600 dark:text-orange-400'],
  verification: [ShieldCheck, 'text-lime-600 dark:text-lime-400'],
  filter: [Filter, 'text-amber-600 dark:text-amber-400'],
  wait: [Hourglass, 'text-slate-500 dark:text-slate-400'],
  journey: [Workflow, 'text-indigo-600 dark:text-indigo-400'],
  mobile: [Smartphone, 'text-pink-600 dark:text-pink-400'],
  sms: [MessageSquare, 'text-pink-600 dark:text-pink-400'],
  refresh: [RefreshCw, 'text-sky-600 dark:text-sky-400'],
  audience: [Users, 'text-fuchsia-600 dark:text-fuchsia-400'],
  other: [Cog, 'text-muted-foreground'],
}
const icon = computed(() => ICONS[activityIconKind(props.type)] || ICONS.other)
</script>

<template>
  <component :is="icon[0]" class="shrink-0" :class="[size, icon[1]]" aria-hidden="true" />
</template>
