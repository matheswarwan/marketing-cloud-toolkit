<script setup>
// Ctrl+K / Cmd+K: jump to a section, open a saved query or email, or search an SFMC
// section (see utils/paletteSearch.js).
import { routeBlocked } from '@/utils/policy.js'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, FileCode2, Mail, Settings, BookOpen, ArrowRight, History } from 'lucide-vue-next'
import { NAV_ITEMS } from '@/app/nav.js'
import { paletteEntries } from '@/utils/paletteSearch.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const router = useRouter()

const SECTIONS = [
  ...NAV_ITEMS,
  { path: '/settings', name: 'Settings', group: 'App', icon: Settings },
  { path: '/features', name: 'Features', group: 'App', icon: BookOpen },
]
const KIND_ICONS = { query: FileCode2, email: Mail, activity: History, search: Search }

const query = ref('')
const active = ref(0)
const input = ref(null)
const storage = ref({})

const entries = computed(() => paletteEntries(query.value, SECTIONS.filter((s) => !routeBlocked(s.path)), storage.value))

watch(() => props.open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  active.value = 0
  try { chrome.storage.local.get(null, (all) => { storage.value = all || {} }) } catch { storage.value = {} }
  await nextTick()
  input.value?.focus()
})
watch(query, () => { active.value = 0 })

function go(entry) {
  if (!entry) return
  router.push(entry.to)
  emit('close')
}

function onKey(e) {
  if (e.key === 'ArrowDown') { active.value = Math.min(active.value + 1, entries.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { active.value = Math.max(active.value - 1, 0); e.preventDefault() }
  else if (e.key === 'Enter') go(entries.value[active.value])
  else if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] bg-black/40" @mousedown.self="emit('close')">
    <div class="w-full max-w-xl mx-4 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden" role="dialog" aria-label="Search">
      <div class="flex items-center gap-2 px-3 border-b border-border">
        <Search class="h-4 w-4 text-muted-foreground" />
        <input ref="input" v-model="query" class="flex-1 h-11 bg-transparent outline-none text-sm"
          placeholder="Go to a section, find a saved query, email or activity, or search SFMC…" role="combobox"
          aria-controls="palette-list" :aria-activedescendant="`palette-${active}`" @keydown="onKey" />
        <kbd class="text-[10px] text-muted-foreground border border-border rounded px-1">Esc</kbd>
      </div>
      <ul id="palette-list" class="max-h-96 overflow-y-auto py-1" role="listbox">
        <li v-for="(e, i) in entries" :id="`palette-${i}`" :key="`${e.kind}:${JSON.stringify(e.to)}`" role="option" :aria-selected="i === active">
          <button class="w-full flex items-center gap-2.5 px-3 h-9 text-sm text-left" :class="i === active ? 'bg-accent text-accent-foreground' : ''"
            @mouseenter="active = i" @click="go(e)">
            <component :is="e.icon || KIND_ICONS[e.kind] || ArrowRight" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate">{{ e.label }}</span>
            <span class="text-xs text-muted-foreground shrink-0">{{ e.hint }}</span>
          </button>
        </li>
        <li v-if="!entries.length" class="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</li>
      </ul>
    </div>
  </div>
</template>
