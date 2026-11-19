<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PanelLeftClose, PanelLeftOpen, Settings, FlaskConical, Info } from 'lucide-vue-next'
import { NAV_GROUPS } from '@/app/nav.js'
import { policy, routeBlocked } from '@/utils/policy.js'
import CreatorCredit from './CreatorCredit.vue'

// To Test link: test builds only (__TEST_BUILD__ is false in store builds).
const testBuild = __TEST_BUILD__

const COLLAPSED_KEY = 'toolkit_sidebar_collapsed'
const stored = ref(false)
try { stored.value = localStorage.getItem(COLLAPSED_KEY) === '1' } catch { /* storage blocked */ }

// In a narrow window (phone width) the sidebar starts as icons only and opening it is not
// remembered, so pages keep their width. It closes again after a page is picked.
const NARROW = '(max-width: 767px)'
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null
const narrow = ref(!!mq?.matches)
const narrowOpen = ref(false)
const onMedia = (e) => { narrow.value = e.matches; narrowOpen.value = false }
mq?.addEventListener?.('change', onMedia)
onBeforeUnmount(() => mq?.removeEventListener?.('change', onMedia))
const route = useRoute()
watch(() => route?.fullPath, () => { narrowOpen.value = false })

const collapsed = computed(() => (narrow.value ? !narrowOpen.value : stored.value))

function toggle() {
  if (narrow.value) { narrowOpen.value = !narrowOpen.value; return }
  stored.value = !stored.value
  try { localStorage.setItem(COLLAPSED_KEY, stored.value ? '1' : '0') } catch { /* storage blocked */ }
}

// Pages an admin policy turned off are left out (utils/policy.js).
const groups = computed(() => (policy.loaded, NAV_GROUPS.filter((g) => !g.hidden).map((g) => ({ ...g, items: g.items.filter((i) => !routeBlocked(i.path)) }))))
</script>

<template>
  <nav
    class="flex flex-col h-full border-r border-border bg-card transition-[width] duration-150 shrink-0"
    :class="collapsed ? 'w-14' : 'w-[220px]'"
    aria-label="Sections"
  >
    <div class="flex-1 overflow-y-auto py-2">
      <div v-for="group in groups" :key="group.label || 'start'" class="mb-1.5">
        <div v-if="!collapsed && group.label" class="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {{ group.label }}
        </div>
        <div v-else-if="collapsed && group.label" class="mx-3 mb-1 border-t border-border" />
        <RouterLink
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          :title="collapsed ? item.name : undefined"
          class="flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded-md text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
          active-class="bg-[#EEF1F5]! dark:bg-accent! text-foreground! font-medium"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ item.name }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="border-t border-border py-2">
      <RouterLink
        v-if="testBuild"
        to="/to-test"
        :title="collapsed ? 'To Test (test build)' : undefined"
        class="flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded-md text-sm text-amber-800 dark:text-amber-300 hover:bg-accent"
        active-class="bg-amber-100! dark:bg-amber-900/40! font-medium"
        data-to-test-link
      >
        <FlaskConical class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">To Test</span>
        <span v-if="!collapsed" class="ml-auto text-[10px] uppercase tracking-wide">test build</span>
      </RouterLink>
      <RouterLink
        to="/settings"
        :title="collapsed ? 'Settings' : undefined"
        class="flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded-md text-sm text-foreground/80 hover:bg-accent"
        active-class="bg-[#EEF1F5]! dark:bg-accent! text-foreground! font-medium"
      >
        <Settings class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">Settings</span>
      </RouterLink>
      <RouterLink
        to="/about"
        :title="collapsed ? 'About' : undefined"
        class="flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded-md text-sm text-foreground/80 hover:bg-accent"
        active-class="bg-[#EEF1F5]! dark:bg-accent! text-foreground! font-medium"
        data-about-link
      >
        <Info class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">About</span>
      </RouterLink>
      <button
        class="flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded-md text-sm text-muted-foreground hover:bg-accent w-[calc(100%-0.75rem)]"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <PanelLeftOpen v-if="collapsed" class="h-4 w-4 shrink-0" />
        <PanelLeftClose v-else class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">Collapse</span>
      </button>
      <p v-if="!collapsed" class="px-4 pt-1 text-[11px] text-muted-foreground truncate"><CreatorCredit /></p>
    </div>
  </nav>
</template>
