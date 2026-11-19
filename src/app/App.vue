<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search, MessageSquare, Network, Loader2 } from 'lucide-vue-next'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import ConnectionMenu from '@/components/shell/ConnectionMenu.vue'
import CommandPalette from '@/components/shell/CommandPalette.vue'
import MessageBar from '@/components/shell/MessageBar.vue'
import ConfirmHost from '@/components/shell/ConfirmHost.vue'
import ApiConsole from '@/components/shell/ApiConsole.vue'
import WhatsNew from '@/components/shell/WhatsNew.vue'
import UpdateBanner from '@/components/shell/UpdateBanner.vue'
import SecretAlerts from '@/components/shell/SecretAlerts.vue'
import { refreshSecrets } from '@/composables/useSecretAlerts.js'
import { cleanUpOldRuns } from '@/utils/runCleanup.js'
import { resumeSummary } from '@/utils/publicationLists.js'
import { fetchCurrentBU } from '@/utils/sfmcApi.js'
import NoticesMenu from '@/components/shell/NoticesMenu.vue'
import JobsPill from '@/components/shell/JobsPill.vue'
import ConceptsButton from '@/components/shell/ConceptsButton.vue'
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'
import { policy } from '@/utils/policy.js'
import FeedbackModal from '@/components/modals/FeedbackModal.vue'
import UsagePanel from '@/components/usage/UsagePanel.vue'
import { useUsage, targetTitle } from '@/composables/useUsage.js'
import { useStack } from '@/composables/useStack.js'
import { sendToBackground } from '@/utils/messaging.js'
import { useTheme } from '@/composables/useTheme.js'
import { paletteState } from '@/composables/usePalette.js'
import { preloadWhenIdle } from '@/utils/preloadOverviews.js'
import { loadEverything } from '@/composables/usePreload.js'
import { errorReport } from '@/composables/useReportError.js'

const route = useRoute()
const KEEP_ALIVE = ['WorkspacePage', 'BuilderPage', 'DataExtensionsPage', 'WhereUsedPage', 'DEStoragePage', 'AutomationsPage', 'ActivitiesPage', 'JourneysPage', 'JourneyEntryPage', 'CloudPagesPage']

// One scrolling <main> serves every page, so a new page used to open at the previous
// page's scroll position (feedback #1110: Features opened halfway down). A new page
// starts at the top; a kept-alive page comes back where it was left.
const mainEl = ref(null)
const scrollByPath = new Map()
const isKeptAlive = () => route.matched.some((r) => {
  const c = r.components?.default
  return KEEP_ALIVE.includes(c?.name || c?.__name)
})
watch(() => route.path, async (to, from) => {
  const el = mainEl.value
  if (!el) return
  if (from) scrollByPath.set(from, el.scrollTop)
  await nextTick()
  el.scrollTop = isKeptAlive() ? (scrollByPath.get(to) || 0) : 0
})
// The palette can also be opened with text (Home's search box): composables/usePalette.js.
const paletteOpen = computed({
  get: () => paletteState.value.open,
  set: (v) => { paletteState.value = { open: v, text: v ? paletteState.value.text : '' } },
})
const showFeedback = ref(false)
// Report the error (any error message): the form opens with the error filled in.
watch(errorReport, (r) => { if (r) showFeedback.value = true })
function closeFeedback() { showFeedback.value = false; errorReport.value = null }
const isMac = /Mac/i.test(navigator.platform || '')
const usage = useUsage()
const usagePercent = computed(() => Math.round(100 * usage.progress()))

// When at least one SFMC app already has a session, start the missing ones in the
// background (the service worker decides, at most every 10 minutes per stack; off in
// Settings). With none, the user is probably not logged in, so nothing is opened.
const { stack } = useStack()
watch(stack, (s) => { if (s) sendToBackground({ type: 'SFMC_WARM_UP', stack: s }) }, { immediate: true })
// Watched automations are checked when the Toolkit opens (feedback #50).
watch(stack, (s) => { if (s) sendToBackground({ type: 'WATCH_CHECK', stack: s, force: true }).catch(() => undefined) }, { immediate: true })
// Automation and Journey overview read quietly once the browser is idle (feedback #78).
watch(stack, (s) => preloadWhenIdle(s), { immediate: true })
// Installed package secrets expiring within a week show at the top (user, 2026-11-05).
watch(stack, (s) => { if (s) refreshSecrets(s).catch(() => undefined) }, { immediate: true })
// Run Query's data extensions and Query activities older than 7 days (Settings) are
// deleted, once a day per stack, a minute after opening (feedback #1081).
watch(stack, (s) => { if (s) setTimeout(() => cleanUpOldRuns(s).catch(() => undefined), 60000) }, { immediate: true })
// Publication list counts still running when the Toolkit was closed are picked up (#1080).
watch(stack, (s) => { if (s) fetchCurrentBU(s).then((bu) => bu && resumeSummary(s, bu.accountId)).catch(() => undefined) }, { immediate: true })
// Load everything when connected (feedback #1037): Settings > Connection, off by default.
let preloadedFor = null
function maybeLoadEverything(s) {
  if (!s || preloadedFor === s) return
  try {
    chrome.storage.local.get('_preloadOnConnect', (r) => {
      if (r?._preloadOnConnect !== true || preloadedFor === s) return
      preloadedFor = s
      loadEverything(s).catch(() => undefined)
    })
  } catch { /* not in an extension */ }
}
watch(stack, maybeLoadEverything, { immediate: true })

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

onMounted(() => {
  useTheme().loadTheme()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- Redesign (feedback #1031): the header runs across the top, the sidebar sits under it. -->
  <div class="flex flex-col h-screen overflow-hidden bg-background text-foreground">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[52px] px-4 py-1.5 border-b border-border bg-card shrink-0">
      <RouterLink to="/home" class="flex items-center gap-2.5 font-semibold text-[15px] shrink-0" title="Home">
        <img src="/images/icon32x32.png" alt="" class="h-[26px] w-[26px] rounded-lg" />
        <span class="hidden md:inline">Marketing Cloud Toolkit</span>
      </RouterLink>
      <div class="min-w-0 flex-1 flex items-center gap-1.5 text-sm">
        <span class="hidden md:inline text-border" aria-hidden="true">/</span>
        <span v-if="route.meta.group" class="text-muted-foreground truncate">{{ route.meta.group }} /</span>
        <span class="font-medium truncate">{{ route.meta.title }}</span>
      </div>
      <button
        class="hidden sm:flex items-center gap-2 h-9 w-56 px-3 rounded-full border border-border bg-card text-sm text-muted-foreground hover:bg-accent"
        @click="paletteOpen = true"
      >
        <Search class="h-4 w-4" />
        <span class="flex-1 text-left">Search</span>
        <kbd class="text-[11px] border border-border rounded px-1.5 font-sans">{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
      </button>
      <button v-if="usage.state.target && !usage.state.open" class="flex items-center gap-1.5 h-9 rounded-full border border-border px-3 text-xs hover:bg-accent" :title="`Where used: ${targetTitle(usage.state.target)}`" @click="usage.state.open = true">
        <Loader2 v-if="usage.state.running" class="h-3.5 w-3.5 animate-spin text-primary" /><Network v-else class="h-3.5 w-3.5" />
        <span class="max-w-32 truncate">{{ targetTitle(usage.state.target) }}</span>
        <span v-if="usage.state.running" class="text-muted-foreground">{{ usagePercent }}%</span>
      </button>
      <JobsPill />
      <ConnectionMenu />
      <ConceptsButton />
      <NoticesMenu />
      <button v-if="!policy.disableFeedback" class="h-9 w-9 flex items-center justify-center rounded-lg text-foreground/80 hover:bg-accent" title="Send feedback" aria-label="Send feedback" @click="showFeedback = true">
        <MessageSquare class="h-[18px] w-[18px]" />
      </button>
      <ThemeSwitcher />
    </header>
    <div class="flex flex-1 min-h-0">
    <AppSidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <SecretAlerts variant="bar" />
      <MessageBar />
      <main ref="mainEl" class="flex-1 min-h-0 overflow-auto">
        <!-- These stay alive in the background, so a running query, a half-built join
             or a list of search results survives a visit to another section. -->
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="KEEP_ALIVE">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
      <ApiConsole />
    </div>
    </div>
    <CommandPalette :open="paletteOpen" :initial-text="paletteState.text" @close="paletteOpen = false" />
    <UsagePanel />
    <ConfirmHost />
    <WhatsNew />
    <UpdateBanner />
    <FeedbackModal v-if="showFeedback && !policy.disableFeedback" :key="errorReport ? errorReport.details : 'feedback'" :screen="route.path" :prefill="errorReport" @close="closeFeedback" />
  </div>
</template>
