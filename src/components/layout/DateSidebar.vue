<script setup>
import { ref } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'

const props = defineProps({
  groups:          { type: Array,  default: () => [] },
  activeKey:       { default: null },
  totalCount:      { type: Number, default: 0 },
  buOptions:       { type: Array,  default: () => [] },
  activeBuFilters: { type: Set,    default: () => new Set() },
})
const emit = defineEmits(['select', 'bu-filter-change'])

const sidebarWidth = ref(144)
const isResizing   = ref(false)
const buFilterOpen = ref(false)

function startResize(e) {
  isResizing.value = true
  const startX     = e.clientX
  const startWidth = sidebarWidth.value
  function onMove(ev) {
    sidebarWidth.value = Math.min(260, Math.max(100, startWidth + (ev.clientX - startX)))
  }
  function onUp() {
    isResizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function toggleBuFilter(buName) {
  const next = new Set(props.activeBuFilters)
  if (next.has(buName)) next.delete(buName)
  else next.add(buName)
  emit('bu-filter-change', next)
}

function clearBuFilters() {
  emit('bu-filter-change', new Set())
}
</script>

<template>
  <aside
    class="relative shrink-0 h-full bg-card border-r border-border py-3 px-2 overflow-y-auto"
    :style="{ width: sidebarWidth + 'px' }"
  >

    <!-- BU Filter (collapsed by default) -->
    <div v-if="buOptions.length > 0" class="mb-1">
      <button
        class="flex items-center justify-between w-full px-1.5 pb-2 text-left border-none bg-transparent cursor-pointer group"
        @click="buFilterOpen = !buFilterOpen"
      >
        <span class="text-[10px] font-bold text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
          By Business Unit
        </span>
        <div class="flex items-center gap-1">
          <span v-if="activeBuFilters.size > 0"
            class="text-[9px] font-bold bg-primary text-white rounded-full px-1.5 py-px min-w-[16px] text-center">
            {{ activeBuFilters.size }}
          </span>
          <ChevronDown
            class="h-3 w-3 text-muted-foreground transition-transform duration-150"
            :class="{ 'rotate-180': buFilterOpen }"
          />
        </div>
      </button>

      <div v-if="buFilterOpen" class="flex flex-col gap-px mb-1.5">
        <button
          v-for="bu in buOptions"
          :key="bu.name"
          class="flex items-center justify-between w-full px-2 py-1.5 rounded-md border-none cursor-pointer text-left transition-colors"
          :class="activeBuFilters.has(bu.name)
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground hover:bg-muted'"
          :title="bu.name + (bu.accountId ? ' · ' + bu.accountId : '')"
          @click="toggleBuFilter(bu.name)"
        >
          <span class="text-xs font-medium truncate"
            :class="activeBuFilters.has(bu.name) ? 'text-primary font-semibold' : 'text-muted-foreground'">
            {{ bu.name }}
          </span>
          <span class="text-[10px] font-semibold rounded-full px-1.5 py-px ml-1 shrink-0 tabular-nums"
            :class="activeBuFilters.has(bu.name)
              ? 'bg-primary text-white'
              : 'bg-muted text-muted-foreground'">
            {{ bu.count }}
          </span>
        </button>

        <button v-if="activeBuFilters.size > 0"
          class="flex items-center justify-center gap-1 w-full mt-1 py-1 px-2 border border-border rounded-md bg-transparent text-[11px] text-muted-foreground cursor-pointer hover:bg-muted hover:text-primary transition-colors"
          @click="clearBuFilters">
          <X class="h-3 w-3" /> Clear filter
        </button>
      </div>

      <div class="h-px bg-border my-1.5 mx-1" />
    </div>

    <!-- Date Filter title -->
    <div class="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1.5 pb-2">
      By Date
    </div>

    <!-- All -->
    <button
      class="flex items-center justify-between w-full px-2 py-1.5 rounded-md border-none cursor-pointer text-left transition-colors"
      :class="activeKey === null
        ? 'bg-primary/10 text-primary'
        : 'bg-transparent text-muted-foreground hover:bg-muted'"
      @click="$emit('select', null)"
    >
      <span class="text-xs font-medium"
        :class="activeKey === null ? 'text-primary font-semibold' : ''">All</span>
      <span class="text-[10px] font-semibold rounded-full px-1.5 py-px ml-1 shrink-0 tabular-nums"
        :class="activeKey === null ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'">
        {{ totalCount }}
      </span>
    </button>

    <div v-if="groups.length > 0" class="h-px bg-border my-1.5 mx-1" />

    <button
      v-for="group in groups"
      :key="group.key"
      class="flex items-center justify-between w-full px-2 py-1.5 rounded-md border-none cursor-pointer text-left transition-colors"
      :class="activeKey === group.key
        ? 'bg-primary/10 text-primary'
        : 'bg-transparent text-muted-foreground hover:bg-muted'"
      @click="$emit('select', group.key)"
    >
      <span class="text-xs font-medium truncate"
        :class="activeKey === group.key ? 'text-primary font-semibold' : ''">
        {{ group.label }}
      </span>
      <span class="text-[10px] font-semibold rounded-full px-1.5 py-px ml-1 shrink-0 tabular-nums"
        :class="activeKey === group.key ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'">
        {{ group.count }}
      </span>
    </button>

    <!-- Resize handle -->
    <div
      class="resize-handle"
      :class="{ 'resize-handle--active': isResizing }"
      @mousedown.prevent="startResize"
    />
  </aside>
</template>

<style scoped>
.resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  left: 2px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle:hover::after,
.resize-handle--active::after {
  background: hsl(var(--primary));
}
</style>
