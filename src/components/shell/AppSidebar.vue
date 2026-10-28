<script setup>
import { computed, ref } from 'vue'
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-vue-next'
import { NAV_GROUPS } from '@/app/nav.js'
import { policy, routeBlocked } from '@/utils/policy.js'
import CreatorCredit from './CreatorCredit.vue'

const COLLAPSED_KEY = 'toolkit_sidebar_collapsed'
const collapsed = ref(false)
try { collapsed.value = localStorage.getItem(COLLAPSED_KEY) === '1' } catch { /* storage blocked */ }

function toggle() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0') } catch { /* storage blocked */ }
}

// Pages an admin policy turned off are left out (utils/policy.js).
const groups = computed(() => (policy.loaded, NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !routeBlocked(i.path)) }))))
</script>

<template>
  <nav
    class="flex flex-col h-full border-r border-border bg-card transition-[width] duration-150"
    :class="collapsed ? 'w-14' : 'w-56'"
    aria-label="Sections"
  >
    <div class="flex items-center gap-2 h-12 px-3 border-b border-border">
      <img src="/images/icon32x32.png" alt="" class="h-6 w-6 shrink-0" />
      <span v-if="!collapsed" class="font-semibold text-sm truncate">Marketing Cloud Toolkit</span>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div v-for="group in groups" :key="group.label" class="mb-3">
        <div v-if="!collapsed" class="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {{ group.label }}
        </div>
        <div v-else class="mx-3 mb-1 border-t border-border" />
        <RouterLink
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          :title="collapsed ? item.name : undefined"
          class="flex items-center gap-2.5 mx-2 px-2 h-8 rounded-md text-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground"
          active-class="bg-primary/10! text-primary! font-medium"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ item.name }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="border-t border-border py-2">
      <RouterLink
        to="/settings"
        :title="collapsed ? 'Settings' : undefined"
        class="flex items-center gap-2.5 mx-2 px-2 h-8 rounded-md text-sm text-foreground/80 hover:bg-accent"
        active-class="bg-primary/10! text-primary! font-medium"
      >
        <Settings class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">Settings</span>
      </RouterLink>
      <button
        class="flex items-center gap-2.5 mx-2 px-2 h-8 rounded-md text-sm text-muted-foreground hover:bg-accent w-[calc(100%-1rem)]"
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
