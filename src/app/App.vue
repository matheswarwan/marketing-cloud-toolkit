<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search, MessageSquare, Network, Loader2 } from 'lucide-vue-next'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import ConnectionMenu from '@/components/shell/ConnectionMenu.vue'
import CommandPalette from '@/components/shell/CommandPalette.vue'
import ToastHost from '@/components/shell/ToastHost.vue'
import ApiConsole from '@/components/shell/ApiConsole.vue'
import WhatsNew from '@/components/shell/WhatsNew.vue'
import UpdateBanner from '@/components/shell/UpdateBanner.vue'
import NoticesMenu from '@/components/shell/NoticesMenu.vue'
import ThemeSwitcher from '@/components/ui/ThemeSwitcher.vue'
import { policy } from '@/utils/policy.js'
import FeedbackModal from '@/components/modals/FeedbackModal.vue'
import UsagePanel from '@/components/usage/UsagePanel.vue'
import { useUsage, targetTitle } from '@/composables/useUsage.js'
import { useStack } from '@/composables/useStack.js'
import { sendToBackground } from '@/utils/messaging.js'
import { useTheme } from '@/composables/useTheme.js'
import { preloadWhenIdle } from '@/utils/preloadOverviews.js'

const route = useRoute()
const KEEP_ALIVE = ['WorkspacePage', 'BuilderPage', 'DataExtensionsPage', 'WhereUsedPage', 'DEStoragePage', 'AutomationsPage', 'ActivitiesPage', 'JourneysPage', 'JourneyEntryPage', 'CloudPagesPage']
const paletteOpen = ref(false)
const showFeedback = ref(false)
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
  <div class="flex h-screen overflow-hidden bg-background text-foreground">
    <AppSidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <header class="flex items-center gap-3 h-12 px-4 border-b border-border bg-card">
        <div class="min-w-0 flex-1">
          <span v-if="route.meta.group" class="text-xs text-muted-foreground">{{ route.meta.group }} / </span>
          <span class="text-sm font-semibold">{{ route.meta.title }}</span>
        </div>
        <button
          class="hidden sm:flex items-center gap-2 h-8 w-56 px-2.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-accent"
          @click="paletteOpen = true"
        >
          <Search class="h-3.5 w-3.5" />
          <span class="flex-1 text-left">Search</span>
          <kbd class="text-[10px] border border-border rounded px-1">{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
        </button>
        <button v-if="usage.state.target && !usage.state.open" class="flex items-center gap-1.5 h-8 rounded-md border border-border px-2 text-xs hover:bg-accent" :title="`Where used: ${targetTitle(usage.state.target)}`" @click="usage.state.open = true">
          <Loader2 v-if="usage.state.running" class="h-3.5 w-3.5 animate-spin text-primary" /><Network v-else class="h-3.5 w-3.5" />
          <span class="max-w-32 truncate">{{ targetTitle(usage.state.target) }}</span>
          <span v-if="usage.state.running" class="text-muted-foreground">{{ usagePercent }}%</span>
        </button>
        <ConnectionMenu />
        <NoticesMenu />
        <button v-if="!policy.disableFeedback" class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent" title="Send feedback" @click="showFeedback = true">
          <MessageSquare class="h-4 w-4" />
        </button>
        <ThemeSwitcher />
      </header>
      <main class="flex-1 min-h-0 overflow-auto">
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
    <CommandPalette :open="paletteOpen" @close="paletteOpen = false" />
    <UsagePanel />
    <ToastHost />
    <WhatsNew />
    <UpdateBanner />
    <FeedbackModal v-if="showFeedback && !policy.disableFeedback" :screen="route.path" @close="showFeedback = false" />
  </div>
</template>
