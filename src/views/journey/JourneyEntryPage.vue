<script setup>
// Journey entry events (SFMC Automation Viewer's Journey Activity Details): every
// event definition (up to 1,000), filtered here in the page.
import { computed, reactive, ref, watch } from 'vue'
import { Loader2, RefreshCw, X, Network, ExternalLink } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { findUsage } from '@/utils/usage/index.js'
import { useUsage } from '@/composables/useUsage.js'
import ActivityCard from '@/components/results/ActivityCard.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import Button from '@/components/ui/button/Button.vue'
import SfmcErrorNotice from '@/components/results/SfmcErrorNotice.vue'
import { withReconnect, searchError } from '@/utils/sfmcErrors.js'
import { useStack } from '@/composables/useStack.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'
import { fetchEventDefinitions, filterEventDefinitions, describeEventDefinition, EVENT_TYPES, EVENT_CATEGORIES } from '@/utils/journeyApi.js'
import { activityBlocks } from '@/utils/activityTypes.js'
import { RESULTS_PAGE_SIZE } from '@/utils/paging.js'

const { stack } = useStack()
const usage = useUsage()
const items = ref([])
const total = ref(0)
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const showAllFields = ref(false)
const filters = reactive({ name: '', key: '', deName: '', deId: '', type: '', category: '', journeyStatus: '', scheduledFrom: false })

async function load() {
  if (!stack.value) { error.value = 'Not connected to Marketing Cloud. Log in to SFMC in this browser.'; return }
  loading.value = true
  error.value = ''
  try {
    const r = await withReconnect(stack.value, () => fetchEventDefinitions(stack.value))
    items.value = r.items
    total.value = r.total
    loaded.value = true
  } catch (e) {
    error.value = searchError(e, 'load journey entry events')
  } finally {
    loading.value = false
  }
}
// Loads the first time the section opens with a known stack.
watch(stack, (s) => { if (s && !loaded.value && !loading.value) load() }, { immediate: true })

const shown = computed(() => filterEventDefinitions(items.value, filters))
const descs = computed(() => shown.value.map((it) => describeEventDefinition(it, stack.value)))
// All entry events load together (the filters work here); they are shown 50 at a time.
const visibleCount = ref(RESULTS_PAGE_SIZE)
watch(filters, () => { visibleCount.value = RESULTS_PAGE_SIZE }, { deep: true })
const anyFilter = computed(() => Object.values(filters).some(Boolean))
function clearFilters() { Object.assign(filters, { name: '', key: '', deName: '', deId: '', type: '', category: '', journeyStatus: '', scheduledFrom: false }) }

useRouteSearch('/journey-entry', (q) => { filters.name = q })

// Feedback #54: open the journey that uses an entry event. The journeys come from
// the same list Where used keeps (read once, then only changes), so one journey
// opens directly and several show in the Where used panel.
const router = useRouter()
const finding = ref('')
const findNote = reactive({})
async function openJourney(ev) {
  if (finding.value) return
  finding.value = ev.id
  delete findNote[ev.id]
  try {
    const r = await findUsage(stack.value, { kind: 'event', event: ev })
    const journeys = r.sections.find((s) => s.id === 'journeys')?.items || []
    if (journeys.length === 1) router.push(journeys[0].route)
    else if (journeys.length) usage.start(stack.value, { kind: 'event', event: ev })
    else findNote[ev.id] = 'No journey uses this entry event.'
  } catch (e) {
    findNote[ev.id] = `Could not look up the journeys: ${e.message}`
  } finally {
    finding.value = ''
  }
}

function getDoc() {
  return { title: 'Journey entry events', blocks: descs.value.flatMap((d) => activityBlocks(d, '', 2)) }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex flex-wrap items-end gap-2 px-4 py-2 border-b border-border bg-card text-xs">
      <label class="flex flex-col gap-0.5">Name<input v-model="filters.name" type="search" class="h-8 w-40 rounded-md border border-border bg-background px-2" /></label>
      <label class="flex flex-col gap-0.5">Event definition key<input v-model="filters.key" type="search" class="h-8 w-40 rounded-md border border-border bg-background px-2" /></label>
      <label class="flex flex-col gap-0.5">Data extension name<input v-model="filters.deName" type="search" class="h-8 w-40 rounded-md border border-border bg-background px-2" /></label>
      <label class="flex flex-col gap-0.5">Data extension ID<input v-model="filters.deId" type="search" class="h-8 w-36 rounded-md border border-border bg-background px-2" /></label>
      <label class="flex flex-col gap-0.5">Type
        <select v-model="filters.type" class="h-8 rounded-md border border-border bg-background px-1">
          <option value="">Any</option><option v-for="(label, k) in EVENT_TYPES" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5">Category
        <select v-model="filters.category" class="h-8 rounded-md border border-border bg-background px-1">
          <option value="">Any</option><option v-for="(label, k) in EVENT_CATEGORIES" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5">Journey status
        <select v-model="filters.journeyStatus" class="h-8 rounded-md border border-border bg-background px-1">
          <option value="">Any</option><option value="active">Active</option><option value="inactive">Not active</option>
        </select>
      </label>
      <label class="flex items-center gap-1.5 h-8"><input v-model="filters.scheduledFrom" type="checkbox" /> Scheduled today or later</label>
      <button v-if="anyFilter" class="flex items-center gap-1 h-8 text-muted-foreground hover:text-foreground" @click="clearFilters"><X class="h-3.5 w-3.5" /> Clear</button>
      <div class="flex-1" />
      <label v-if="shown.length" class="flex items-center gap-1.5 h-8 text-muted-foreground"><input v-model="showAllFields" type="checkbox" /> All fields</label>
      <DownloadMenu v-if="shown.length" :get-doc="getDoc" file-name="journey-entry-events" />
      <Button variant="ghost" size="icon" class="h-8 w-8" title="Load again from Journey Builder" :disabled="loading" @click="load">
        <Loader2 v-if="loading" class="h-4 w-4 animate-spin" /><RefreshCw v-else class="h-4 w-4" />
      </Button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <SfmcErrorNotice :error="error" :retrying="loading" @retry="load" />
      <div v-if="loading && !loaded" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Loading journey entry events…</div>
      <template v-else-if="loaded">
        <p class="mb-2 text-xs text-muted-foreground">
          {{ shown.length }} of {{ items.length }} entry events match<template v-if="shown.length > visibleCount">, the first {{ visibleCount }} shown</template>.<template v-if="total > items.length"> Journey Builder has {{ total }}; the first {{ items.length }} are loaded.</template>
        </p>
        <div class="space-y-3">
          <ActivityCard v-for="(d, i) in descs.slice(0, visibleCount)" :key="shown[i].id || i" :description="d" :show-all-fields="showAllFields">
            <template #actions>
              <span v-if="findNote[shown[i].id]" class="text-xs text-muted-foreground">{{ findNote[shown[i].id] }}</span>
              <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0 disabled:opacity-50" title="Open the journey that uses this entry event (several show in Where used)" :disabled="!!finding" @click="openJourney(shown[i])">
                <Loader2 v-if="finding === shown[i].id" class="h-3 w-3 animate-spin" /><ExternalLink v-else class="h-3 w-3" /> Open journey
              </button>
              <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0" title="Journeys that use this entry event" @click="usage.start(stack, { kind: 'event', event: shown[i] })"><Network class="h-3 w-3" /> Where used</button>
            </template>
          </ActivityCard>
        </div>
        <div v-if="visibleCount < shown.length" class="mt-3 text-center">
          <Button variant="outline" size="sm" class="h-8 text-xs" @click="visibleCount += RESULTS_PAGE_SIZE">
            Load {{ Math.min(50, shown.length - visibleCount) }} more ({{ visibleCount }} of {{ shown.length }})
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
