<script setup>
// "Where used" for anything (see utils/usage/): the scan's steps with progress bars
// while it runs (it carries on in the background when the panel is closed), then the
// results in sections. Mounted once in App.vue.
// On the Where used page (route /where-used) the page shows it inline (`embedded`), so
// the floating copy from App.vue stays hidden there.
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  X, RefreshCw, Loader2, Check, AlertCircle, Square, Play, ChevronDown, ChevronRight, Network, ArrowLeft, Minus,
  FileCode, ArrowDownToLine, ArrowUpFromLine, Filter, Braces, Send, Zap, Route as RouteIcon, LayoutTemplate, Database, Workflow, List, GitBranch, Waypoints,
} from 'lucide-vue-next'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import DownloadMenu from '@/components/results/DownloadMenu.vue'
import LineageNode from './LineageNode.vue'
import UsageItemCard from './UsageItemCard.vue'
import UsageMap from './UsageMap.vue'
import { buildUsageMap } from '@/utils/usage/graph.js'
import { layoutUsageMap } from '@/utils/usage/graphLayout.js'
import { usageMapSvg } from '@/utils/usage/graphSvg.js'
import { useUsage, targetTitle, targetKindLabel } from '@/composables/useUsage.js'
import AiButton from '@/components/ai/AiButton.vue'
import AskAiDialog from '@/components/ai/AskAiDialog.vue'
import { useAi } from '@/composables/useAi.js'
import { AI_TEXT_SYSTEM, buildAiTaskPrompt, docText } from '@/utils/aiAssist.js'

const props = defineProps({
  embedded: { type: Boolean, default: false }, // shown inside the Where used page
})
const router = useRouter()
const route = useRoute()
const { state, start, stop, follow, back, progress, toggleSkip, canSkip, again } = useUsage()
const onPage = computed(() => route?.path === '/where-used')
const shown = computed(() => state.open && state.target && (props.embedded || !onPage.value))
const skipped = (id) => state.skip.includes(id)
// A finished check that left out a source the user has ticked again since.
const canInclude = computed(() => !state.running && state.order.some((s) => canSkip(s.id) && !skipped(s.id) && (state.stages[s.id]?.state === 'skipped' || /^skipped,/.test(state.stages[s.id]?.note || ''))))

const percent = computed(() => Math.round(100 * progress()))
const ringPercent = computed(() => (state.running || state.error ? percent.value : 100))
const stopped = computed(() => !state.running && state.error === 'Stopped.')
const FINISHED = ['done', 'cached', 'skipped', 'error']
const stepsDone = computed(() => state.order.filter((s) => FINISHED.includes(state.stages[s.id]?.state)).length)
const runningStage = computed(() => state.order.find((s) => state.stages[s.id]?.state === 'running'))
const scanTitle = computed(() => (state.running ? 'Scanning' : stopped.value ? 'Scan stopped' : state.error ? 'Scan failed' : 'Scan finished'))
const scanSub = computed(() => {
  const steps = `${stepsDone.value} of ${state.order.length} steps done`
  if (state.running) return runningStage.value ? `${steps} · ${runningStage.value.label.replace(/^Loading /, 'reading ')}` : steps
  if (stopped.value) return `${steps}. Resume to carry on; what was already read is reused.`
  if (state.error) return state.error
  return steps
})
function resume() { again() }
const sections = computed(() => state.result?.sections || [])
const total = computed(() => sections.value.reduce((n, s) => n + (s.items?.length || 0), 0))
const title = computed(() => state.result?.title || targetTitle(state.target))

const collapsed = ref(new Set())
watch(() => state.target, () => { collapsed.value = new Set() })
// Separate functions: in the template a ref passed as an argument arrives unwrapped,
// so a shared toggle(setRef, k) could not replace the Set (feedback #25).
function flip(set, k) {
  const next = new Set(set)
  next.has(k) ? next.delete(k) : next.add(k)
  return next
}
function toggleSection(k) { collapsed.value = flip(collapsed.value, k) }

// Map or list (user, 2026-11-16): the map when the check has one (data extensions and
// data views), remembered.
const VIEW_KEY = 'toolkit_usageView'
function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map' } catch { return 'map' }
}
const view = ref(readView())
function setView(v) {
  view.value = v
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
}
const hasMap = computed(() => !!state.result?.map)
const showingMap = computed(() => hasMap.value && view.value === 'map')

function stageText(s) {
  if (!s) return ''
  if (s.state === 'skipped') return s.note ? `Skipped: ${s.note}` : 'Skipped'
  if (s.state === 'waiting') return 'Waiting'
  if (s.state === 'stopped') return 'Stopped'
  if (s.state === 'error') return `Failed: ${s.note}`
  const count = s.total ? `${s.done.toLocaleString()} of ${s.total.toLocaleString()}` : s.done ? s.done.toLocaleString() : ''
  const parts = [count, s.note].filter(Boolean)
  return parts.join(', ') || (s.state === 'running' ? 'Starting' : 'Done')
}

function go(to) { router.push(to) }

// Results summary tiles: one per section, with its real count.
const TILE = {
  queries: { icon: FileCode, tone: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  imports: { icon: ArrowDownToLine, tone: 'bg-primary/10 text-primary' },
  extracts: { icon: ArrowUpFromLine, tone: 'bg-primary/10 text-primary' },
  filters: { icon: Filter, tone: 'bg-muted text-foreground' },
  scripts: { icon: Braces, tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  sends: { icon: Send, tone: 'bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300' },
  events: { icon: Zap, tone: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  journeys: { icon: RouteIcon, tone: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  content: { icon: LayoutTemplate, tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  tables: { icon: Database, tone: 'bg-primary/10 text-primary' },
  source: { icon: Database, tone: 'bg-primary/10 text-primary' },
  automation: { icon: Workflow, tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  lineage: { icon: GitBranch, tone: 'bg-primary/10 text-primary' },
}
const tileOf = (id) => TILE[id] || { icon: List, tone: 'bg-muted text-foreground' }
function tileCount(s) {
  if (!s.tree) return String(s.items.length)
  const up = s.tree.up?.children?.length
  const down = s.tree.down?.children?.length
  return [up != null ? `${up} in` : '', down != null ? `${down} out` : ''].filter(Boolean).join(' · ')
}
const body = ref(null)
async function jumpTo(id) {
  if (showingMap.value) setView('list')
  if (collapsed.value.has(id)) toggleSection(id)
  await nextTick()
  body.value?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function pivotDE(name) { follow({ kind: 'de', de: { name } }) }

function lineageRows(node, direction, depth = 0, rows = []) {
  for (const c of node?.children || []) {
    rows.push([`${'  '.repeat(depth)}${direction === 'up' ? 'from' : 'to'} ${c.via.kind} ${c.via.name}`, c.name || (c.via.file ? `file ${c.via.file}` : 'a file')])
    lineageRows(c, direction, depth + 1, rows)
  }
  return rows
}

// Summarize with AI (feedback #1029, experimental): the download's text.
const ai = useAi()
const summaryOpen = ref(false)
const summaryPrompt = (extra) => buildAiTaskPrompt('whereUsed', { text: docText(buildDoc()) + (extra.trim() ? `\n\nAlso answer: ${extra.trim()}` : '') })
function buildDoc() {
  const blocks = [{ type: 'p', text: `${targetKindLabel(state.target)}: ${title.value}. ${total.value} found. Current business unit only.` }]
  if (state.result?.map) {
    // The map at its default view (2 levels, automations shown), as in the panel.
    const svg = usageMapSvg(layoutUsageMap(buildUsageMap(state.result.map, { depth: 2 })))
    blocks.push({ type: 'h', level: 2, text: 'Map' }, { type: 'svg', svg, note: 'Map: in the HTML and PDF downloads.' })
  }
  for (const s of sections.value) {
    blocks.push({ type: 'h', level: 2, text: s.title })
    if (s.tree) {
      for (const [dir, label] of [['up', 'Comes from'], ['down', 'Goes to']]) {
        if (!s.tree[dir]) continue
        const rows = lineageRows(s.tree[dir], dir)
        blocks.push({ type: 'p', text: label }, rows.length ? { type: 'table', columns: ['Through', 'Data extension'], rows } : { type: 'p', text: 'Nothing found.' })
      }
      continue
    }
    if (!s.items.length) { blocks.push({ type: 'p', text: s.empty }); continue }
    blocks.push({
      type: 'table',
      columns: ['Name', 'Type', 'How', 'Details', 'Automations'],
      rows: s.items.map((i) => [i.title, i.kind, i.badges.map((b) => b.text).filter(Boolean).join(', '), i.lines.join('; '),
        i.automations ? (i.automations.map((a) => `${a.name} (step ${a.step})`).join('; ') || 'None') : '']),
    })
  }
  return { title: `Where ${title.value} is used`, blocks }
}
</script>

<template>
  <aside v-if="shown" aria-labelledby="usage-title"
    :role="embedded ? undefined : 'dialog'"
    :class="embedded
      ? 'h-full min-h-0 flex flex-col bg-card text-foreground'
      : 'fixed top-12 bottom-0 right-0 z-110 w-full sm:w-[600px] flex flex-col border-l border-border bg-card text-foreground shadow-2xl'">
    <header class="flex flex-col gap-1.5 px-5 py-4 border-b border-border">
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0">
          <button v-if="state.history.length" class="h-[34px] w-[34px] shrink-0 flex items-center justify-center rounded-xl bg-primary/10 text-primary hover:bg-primary/20" title="Back" aria-label="Back" @click="back"><ArrowLeft class="h-4 w-4" /></button>
          <span v-else class="h-[34px] w-[34px] shrink-0 flex items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Network class="h-4 w-4" /></span>
          <div class="min-w-0 flex flex-col">
            <span class="text-xs text-muted-foreground">Where used · {{ targetKindLabel(state.target) }}</span>
            <h2 id="usage-title" class="text-[17px] font-bold leading-snug break-words">{{ title }}</h2>
          </div>
        </div>
        <button class="h-[34px] w-[34px] shrink-0 flex items-center justify-center rounded-full border border-border bg-card hover:bg-accent"
          :title="state.running ? 'Close (the scan keeps going)' : 'Close'" aria-label="Close" @click="state.open = false"><X class="h-4 w-4" /></button>
      </div>
      <span v-if="state.target.de?.customerKey" class="text-xs text-muted-foreground">Key <code class="font-mono text-[11px]">{{ state.target.de.customerKey }}</code></span>
    </header>

    <div ref="body" class="flex-1 min-h-0 overflow-y-auto">
      <!-- Process -->
      <section class="px-5 py-4 border-b border-border flex flex-col gap-2.5" aria-label="Process">
        <div class="flex items-center gap-3.5">
          <span class="h-14 w-14 shrink-0 rounded-full flex items-center justify-center" role="progressbar" aria-label="Overall progress" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="ringPercent"
            :style="{ background: `conic-gradient(hsl(var(--primary)) 0 ${ringPercent}%, hsl(var(--primary) / 0.12) ${ringPercent}% 100%)` }">
            <span class="h-11 w-11 rounded-full bg-card flex items-center justify-center text-[13px] font-bold tabular-nums">{{ ringPercent }}%</span>
          </span>
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span class="text-[15px] font-bold flex items-center gap-1.5">{{ scanTitle }}<Loader2 v-if="state.running" class="h-3.5 w-3.5 animate-spin text-primary" /></span>
            <span class="text-xs text-muted-foreground" :class="{ 'text-red-600 dark:text-red-400': state.error && !stopped }">{{ scanSub }}</span>
          </div>
          <button v-if="state.running" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:bg-accent" @click="stop"><Square class="h-3.5 w-3.5" /> Stop</button>
          <button v-else-if="stopped" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:bg-accent" title="Carry on; data read before stopping is reused" @click="resume"><Play class="h-3.5 w-3.5" /> Resume</button>
          <button v-else-if="canInclude" class="h-[34px] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:bg-accent" title="Check again with the ticked steps; saved data is reused" @click="again"><RefreshCw class="h-3.5 w-3.5" /> Check again</button>
        </div>

        <ol class="flex flex-col">
          <li v-for="(s, i) in state.order" :key="s.id" class="grid grid-cols-[22px_16px_minmax(0,1fr)_auto] items-center gap-2.5 py-[7px]">
            <span class="h-[22px] w-[22px] rounded-full flex items-center justify-center"
              :class="['done', 'cached'].includes(state.stages[s.id]?.state) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                : state.stages[s.id]?.state === 'running' ? 'bg-primary/10 text-primary'
                : state.stages[s.id]?.state === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                : 'bg-muted text-muted-foreground'">
              <Loader2 v-if="state.stages[s.id]?.state === 'running'" class="h-3 w-3 animate-spin" />
              <Check v-else-if="['done', 'cached'].includes(state.stages[s.id]?.state)" class="h-3 w-3" />
              <AlertCircle v-else-if="state.stages[s.id]?.state === 'error'" class="h-3 w-3" />
              <Minus v-else-if="['skipped', 'stopped'].includes(state.stages[s.id]?.state)" class="h-3 w-3" />
            </span>
            <input v-if="canSkip(s.id)" type="checkbox" class="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]" :checked="!skipped(s.id)"
              :aria-label="`Load ${s.label}`" title="Untick to skip this step in this and later checks (saved data is still used)" @change="toggleSkip(s.id)" />
            <span v-else aria-hidden="true" />
            <div class="min-w-0 flex flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2 text-[13px]"
                :class="skipped(s.id) ? 'text-muted-foreground line-through' : state.stages[s.id]?.state === 'waiting' ? 'text-muted-foreground' : ''">
                {{ i + 1 }}. {{ s.label }}
                <button v-if="state.stages[s.id]?.state === 'running' && canSkip(s.id) && !skipped(s.id)" class="text-xs font-semibold text-primary hover:underline"
                  title="Stop loading this step and go on with the next; remembered for later checks" @click="toggleSkip(s.id)">Skip</button>
              </span>
              <ProgressBar v-if="state.stages[s.id]?.state === 'running'" :value="state.stages[s.id].done || 0" :max="state.stages[s.id].total || 0" size="xs" :aria-label="s.label" />
            </div>
            <span class="text-xs text-muted-foreground text-right tabular-nums max-w-[180px] break-words" :class="{ 'text-red-600 dark:text-red-400': state.stages[s.id]?.state === 'error' }">{{ stageText(state.stages[s.id]) }}</span>
          </li>
        </ol>
        <p class="text-xs leading-[18px] text-muted-foreground">
          Untick a step, or Skip it while it loads, to leave it out; data saved by an earlier check is still used and your choice is remembered.
          The scan keeps going if you close this panel or open another section. Automations and journeys are read 10 at a time, so a large business unit takes a while the first time.
          What it reads is saved for this business unit, so later checks (in any tab) only read what changed.
          <button v-if="!state.running" class="text-primary hover:underline" title="Scan again, reloading everything from SFMC" @click="start(state.stack, state.target, { refresh: true, keepHistory: true })">Rescan everything</button>
        </p>
      </section>

      <!-- Results -->
      <section class="px-5 py-4 flex flex-col gap-2.5" aria-label="Results">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-bold flex-1">Results</span>
          <template v-if="state.result">
            <div v-if="hasMap" class="flex rounded-full border border-border p-0.5" role="group" aria-label="Show results as">
              <button type="button" class="h-7 inline-flex items-center gap-1 rounded-full px-2.5 text-xs font-semibold" :class="showingMap ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'"
                :aria-pressed="showingMap" @click="setView('map')"><Waypoints class="h-3.5 w-3.5" /> Map</button>
              <button type="button" class="h-7 inline-flex items-center gap-1 rounded-full px-2.5 text-xs font-semibold" :class="!showingMap ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'"
                :aria-pressed="!showingMap" @click="setView('list')"><List class="h-3.5 w-3.5" /> List</button>
            </div>
            <AiButton label="Summarize" :disabled="!total" title="Summarize what depends on it (experimental, Gemini Nano in Chrome)" @click="summaryOpen = true" />
            <DownloadMenu :get-doc="buildDoc" :file-name="`where-used-${title}`" label="Download" />
          </template>
        </div>
        <p v-if="!state.result" class="text-xs text-muted-foreground">{{ state.running ? 'Results fill in when matching finishes.' : 'No results: the scan did not finish.' }}</p>
        <template v-else>
          <p class="text-xs"><strong>{{ total }}</strong> found. <span class="text-muted-foreground">Current business unit only.</span></p>
          <p v-if="state.result.note" class="text-xs text-muted-foreground">{{ state.result.note }}</p>
          <div v-if="sections.length" class="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
            <button v-for="s in sections" :key="s.id" type="button" class="flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left hover:bg-accent"
              :class="(s.tree || s.items.length) ? 'border-border bg-card' : 'border-dashed border-border'" :title="`Show ${s.title}`" @click="jumpTo(s.id)">
              <span class="h-7 w-7 shrink-0 rounded-xl flex items-center justify-center" :class="tileOf(s.id).tone"><component :is="tileOf(s.id).icon" class="h-3.5 w-3.5" /></span>
              <span class="flex-1 min-w-0 text-[13px] font-medium">{{ s.title }}</span>
              <span class="text-[13px] tabular-nums" :class="s.unavailable ? 'text-red-600 dark:text-red-400' : (s.tree || s.items.length) ? 'font-semibold' : 'text-muted-foreground'"
                :title="s.unavailable ? 'Skipped or could not be loaded: may be incomplete' : ''">{{ tileCount(s) }}{{ s.unavailable ? '?' : '' }}</span>
            </button>
          </div>

          <!-- A fresh canvas per check: vue-flow does not measure a new set of boxes reliably (live test, 2026-11-16). -->
          <UsageMap v-if="showingMap" :key="`${state.runId}:${state.result.map.focus.id}`" :input="state.result.map" class="mt-1" @follow="follow" />
          <div v-for="s in (showingMap ? [] : sections)" :key="s.id" :data-section="s.id" class="mt-2 scroll-mt-2">
            <button class="w-full flex items-center gap-1.5 text-left text-sm font-semibold mb-1.5" :aria-expanded="!collapsed.has(s.id)" @click="toggleSection(s.id)">
              <ChevronDown v-if="!collapsed.has(s.id)" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" />
              {{ s.title }} <span v-if="!s.tree" class="font-normal text-muted-foreground">({{ s.items.length }})</span>
            </button>
            <template v-if="!collapsed.has(s.id)">
              <p v-if="s.unavailable" class="mb-1.5 text-xs text-red-600 dark:text-red-400">This was skipped or could not be loaded (see the steps above), so the list may be incomplete.</p>
              <p v-if="s.note" class="mb-1.5 text-[11px] text-muted-foreground">{{ s.note }}</p>

              <!-- Lineage -->
              <div v-if="s.tree" class="rounded-xl border border-border p-3 text-xs space-y-3">
                <div v-for="[dir, heading, none] in [['up', 'Where its data comes from', 'Nothing writes to it that was found.'], ['down', 'Where its data goes', 'Nothing reads it that was found.']]" :key="dir">
                  <template v-if="s.tree[dir]">
                    <p class="font-semibold mb-1">{{ heading }}</p>
                    <LineageNode v-if="s.tree[dir].children.length" :node="s.tree[dir]" :direction="dir" @pivot="pivotDE" />
                    <p v-else class="text-muted-foreground italic">{{ none }}</p>
                  </template>
                </div>
                <p class="text-[11px] text-muted-foreground">Built from SQL queries, filters, imports and data extracts, by data extension name, up to 6 levels.</p>
              </div>

              <p v-else-if="!s.items.length" class="text-xs text-muted-foreground italic">{{ s.empty }}</p>
              <ul v-else class="space-y-2">
                <li v-for="m in s.items" :key="m.key"><UsageItemCard :item="m" @follow="follow" /></li>
              </ul>
            </template>
          </div>

          <p class="mt-2 text-[11px] text-muted-foreground">
            Only the current business unit is checked. Matches in SQL are by data extension name after FROM or JOIN (comments ignored) and by target key or ID;
            matches in AMPscript, SSJS and journey criteria are by name or key and can miss names built in code. Items with the same name in other business units can't be told apart.
          </p>
        </template>
      </section>
      <AskAiDialog v-if="ai.shown.value && state.result" :open="summaryOpen" title="Summarize where it is used" :system="AI_TEXT_SYSTEM"
        :prompt="summaryPrompt" extra-label="Anything else to ask about it?" @close="summaryOpen = false" />
    </div>
  </aside>
</template>
