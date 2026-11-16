<script setup>
// One Where used result (an activity, journey, email, ...): its kind, name, badges,
// details, the automations it runs in and its code. Used by the results list and by
// the map's details pane.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, ChevronRight, ExternalLink, Network } from 'lucide-vue-next'
import StatusBadge from '@/components/results/StatusBadge.vue'
import ActivityIcon from '@/components/results/ActivityIcon.vue'
import CodeView from '@/components/results/CodeView.vue'
import DERowCount from '@/components/results/DERowCount.vue'
import { activityIconKind } from '@/utils/activityIcons.js'
import { formatDateTime } from '@/utils/format.js'

const props = defineProps({ item: { type: Object, required: true } })
const emit = defineEmits(['follow'])
const router = useRouter()
const codeOpen = ref(false)

const TONES = {
  write: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  read: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  maybe: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  info: 'bg-muted text-muted-foreground',
}
// Activity rows get their type's icon; other kinds (data extension, email, ...) none.
const isActivityKind = (kind) => activityIconKind(kind) !== 'other' && !/data extension|email$|journey|content|page|file location|profile/i.test(String(kind || ''))
const deName = () => props.item.pivot?.de?.name || props.item.title
function go(to) { router.push(to) }
</script>

<template>
  <div class="rounded-xl border border-border bg-card p-3 text-xs">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"><ActivityIcon v-if="item.activityType != null || isActivityKind(item.kind)" :type="item.activityType ?? item.kind" size="h-3 w-3" />{{ item.kind }}</span>
      <button v-if="item.route" class="font-semibold text-sm text-primary hover:underline text-left" @click="go(item.route)">{{ item.title }}</button>
      <!-- A data extension opens on Data Extensions with its details (feedback #1098). -->
      <button v-else-if="item.pivot?.kind === 'de' && deName()" class="font-semibold text-sm text-primary hover:underline text-left" data-open-de
        :title="`Open ${deName()} on Data Extensions`" @click="go(`/data-extensions?q=${encodeURIComponent(deName())}`)">{{ item.title }}</button>
      <span v-else class="font-semibold text-sm">{{ item.title }}</span>
      <DERowCount v-if="item.pivot?.kind === 'de' && item.pivot.de" :name="item.pivot.de.name || ''" :id="item.pivot.de.id || null" />
      <template v-for="(b, bi) in item.badges" :key="bi">
        <StatusBadge v-if="b.tone === 'status' && b.text" :status="b.text" />
        <span v-else-if="b.text && b.tone !== 'status'" class="rounded-md px-2 py-0.5 text-[11px] font-semibold" :class="TONES[b.tone] || TONES.info">{{ b.text }}</span>
      </template>
      <div class="flex-1" />
      <a v-if="item.href" :href="item.href" target="_blank" rel="noopener" class="inline-flex items-center gap-0.5 text-primary hover:underline">SFMC <ExternalLink class="h-3 w-3" /></a>
      <button v-if="item.pivot" class="inline-flex items-center gap-0.5 text-primary hover:underline" :title="`Where is ${item.pivot.de?.name || item.title} used?`" @click="emit('follow', item.pivot)"><Network class="h-3 w-3" /> Where used</button>
    </div>
    <p v-for="(l, li) in item.lines || []" :key="li" class="mt-0.5 text-muted-foreground">{{ l }}</p>
    <div v-if="item.automations !== undefined" class="mt-1.5">
      <p v-if="item.automations === null" class="text-muted-foreground italic">Automations could not be checked.</p>
      <p v-else-if="!item.automations.length" class="text-muted-foreground italic">Not in any automation.</p>
      <ul v-else class="space-y-1">
        <li v-for="a in item.automations" :key="`${a.automationId}-${a.step}`" class="flex flex-wrap items-center gap-1.5">
          <button class="text-primary hover:underline font-medium" @click="go(`/automations/${encodeURIComponent(a.automationId)}`)">{{ a.name }}</button>
          <span class="text-muted-foreground">step {{ a.step }}{{ a.stepName ? ` (${a.stepName})` : '' }}</span>
          <StatusBadge :status="a.status" automation />
          <span v-if="a.lastRunTime" class="text-muted-foreground">last run {{ formatDateTime(a.lastRunTime) }}</span>
        </li>
      </ul>
    </div>
    <template v-if="item.code?.text">
      <button class="mt-1.5 inline-flex items-center gap-1 text-primary hover:underline" :aria-expanded="codeOpen" @click="codeOpen = !codeOpen">
        <ChevronDown v-if="codeOpen" class="h-3.5 w-3.5" /><ChevronRight v-else class="h-3.5 w-3.5" /> {{ item.code.lang === 'sql' ? 'SQL' : 'Code' }}
      </button>
      <div v-if="codeOpen" class="mt-1.5"><CodeView :code="item.code.text" :lang="item.code.lang" max-height="260px" /></div>
    </template>
  </div>
</template>
