<script setup>
// Watch automations (feedback #50) or journeys (#59): one on its page, or every
// ticked row in a list. Pick what to be told about. The service worker checks
// watched items when the Toolkit opens and when an SFMC page loads.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import { WATCHES_KEY, WATCH_OPTIONS, defaultOn, watchKey, addWatches, removeWatches } from '@/utils/watches.js'
import { showToast } from '@/composables/useToast.js'

const props = defineProps({
  stack: { type: String, default: null },
  type: { type: String, default: 'automation' }, // 'automation' or 'journey'
  // [{ id, name, status, ... }]: one item on a detail page, the ticked rows in a list.
  items: { type: Array, default: () => [] },
  // In a list: the button names how many are ticked.
  bulk: { type: Boolean, default: false },
})

const watches = ref({})
const menu = ref(false)
const on = ref({ ...defaultOn(props.type) })
const noun = computed(() => (props.type === 'journey' ? 'journey' : 'automation'))
const watched = computed(() => props.items.filter((it) => watches.value[watchKey(props.stack, it.id, props.type)]))
const allWatched = computed(() => props.items.length > 0 && watched.value.length === props.items.length)
const label = computed(() => {
  if (!props.bulk) return allWatched.value ? 'Watching' : 'Watch'
  const n = props.items.length
  return n ? `Watch ${n}` : 'Watch'
})
const title = computed(() => (props.bulk && !props.items.length ? `Tick ${noun.value}s in the list to watch them` : `Watch ${props.bulk ? `the ticked ${noun.value}s` : `this ${noun.value}`}`))

const load = () => chrome.storage.local.get(WATCHES_KEY, (r) => { watches.value = r?.[WATCHES_KEY] || {} })
const onChange = (c, area) => { if (area === 'local' && WATCHES_KEY in c) watches.value = c[WATCHES_KEY].newValue || {} }
onMounted(() => { try { load(); chrome.storage.onChanged.addListener(onChange) } catch { /* not in an extension */ } })
onUnmounted(() => { try { chrome.storage.onChanged.removeListener(onChange) } catch { /* ignore */ } })

function open() {
  if (!props.items.length) return
  const first = watched.value[0] && watches.value[watchKey(props.stack, watched.value[0].id, props.type)]
  on.value = { ...defaultOn(props.type), ...(first?.on || {}) }
  menu.value = !menu.value
}
function save() {
  if (!props.stack || !props.items.length) return
  chrome.storage.local.set({ [WATCHES_KEY]: addWatches(watches.value, props.stack, props.type, props.items, on.value) })
  menu.value = false
  const what = props.items.length === 1 ? props.items[0].name || `this ${noun.value}` : `${props.items.length} ${noun.value}s`
  showToast(`Watching ${what}. You will see changes when you open Marketing Cloud Toolkit or an SFMC page.`)
}
function stop() {
  chrome.storage.local.set({ [WATCHES_KEY]: removeWatches(watches.value, props.stack, props.type, watched.value.map((it) => it.id)) })
  menu.value = false
}
</script>

<template>
  <div class="relative">
    <button class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
      :class="!bulk && allWatched ? 'border-primary/50 text-primary' : 'border-border'" :disabled="!items.length" :title="title"
      :aria-expanded="menu" aria-haspopup="dialog" @click="open">
      <Eye class="h-3.5 w-3.5" /> {{ label }}
    </button>
    <template v-if="menu">
      <div class="fixed inset-0 z-30" @click="menu = false" />
      <div class="absolute right-0 mt-1 z-40 w-72 rounded-md border border-border bg-popover shadow-lg p-3 text-xs space-y-2" role="dialog" :aria-label="title">
        <div class="font-semibold">Tell me when {{ items.length === 1 ? `this ${noun}` : `any of these ${items.length} ${noun}s` }}</div>
        <label v-for="[k, text] in WATCH_OPTIONS[type]" :key="k" class="flex items-center gap-2"><input v-model="on[k]" type="checkbox" /> {{ text }}</label>
        <p v-if="bulk && watched.length" class="text-muted-foreground">{{ watched.length }} of these {{ watched.length === 1 ? 'is' : 'are' }} already watched; Watch updates their options.</p>
        <p class="text-muted-foreground">Checked when you open Marketing Cloud Toolkit, and at most every 15 minutes while you use SFMC. Changes show on the bell and the toolbar icon.</p>
        <div class="flex items-center gap-2 pt-1">
          <button class="h-7 px-2.5 rounded-md bg-primary text-primary-foreground font-medium" @click="save">{{ allWatched ? 'Save' : 'Watch' }}</button>
          <button v-if="watched.length" class="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border hover:bg-accent" @click="stop">
            <EyeOff class="h-3.5 w-3.5" /> Stop watching{{ bulk && watched.length > 1 ? ` ${watched.length}` : '' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
