<script setup>
// The bell in the top bar: changes to watched automations (feedback #50) and journeys (#59).
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Bell } from 'lucide-vue-next'
import { NOTICES_KEY, unreadCount, noticeRoute } from '@/utils/watches.js'
import { formatDateTime } from '@/utils/format.js'
import { sendToBackground } from '@/utils/messaging.js'

const notices = ref([])
const open = ref(false)
const unread = computed(() => unreadCount(notices.value))
const load = () => chrome.storage.local.get(NOTICES_KEY, (r) => { notices.value = r?.[NOTICES_KEY] || [] })
const onChange = (c, area) => { if (area === 'local' && NOTICES_KEY in c) notices.value = c[NOTICES_KEY].newValue || [] }
onMounted(() => { try { load(); chrome.storage.onChanged.addListener(onChange) } catch { /* not in an extension */ } })
onUnmounted(() => { try { chrome.storage.onChanged.removeListener(onChange) } catch { /* ignore */ } })

async function write(list) {
  await chrome.storage.local.set({ [NOTICES_KEY]: list })
  sendToBackground({ type: 'WATCH_BADGE' }).catch(() => undefined)
}
function toggle() {
  open.value = !open.value
  // Opening the list counts as reading it.
  if (open.value && unread.value) write(notices.value.map((n) => ({ ...n, read: true })))
}
const clear = () => { write([]); open.value = false }
const KIND = { paused: 'Paused', activated: 'Activated', fails: 'Failed', runs: 'Ran', edited: 'Changed' }
</script>

<template>
  <div class="relative">
    <button class="relative p-1.5 rounded-md text-muted-foreground hover:bg-accent" :title="unread ? `${unread} new about watched automations and journeys` : 'Watched automations and journeys'" :aria-expanded="open" @click="toggle">
      <Bell class="h-4 w-4" />
      <span v-if="unread" class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center">{{ unread > 99 ? '99+' : unread }}</span>
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-30" @click="open = false" />
      <div class="absolute right-0 mt-1 z-40 w-96 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover shadow-lg text-xs" role="dialog" aria-label="Watched automations and journeys">
        <div class="flex items-center px-3 py-2 border-b border-border">
          <span class="font-semibold flex-1">Watched automations and journeys</span>
          <button v-if="notices.length" class="text-muted-foreground hover:underline" @click="clear">Clear</button>
        </div>
        <p v-if="!notices.length" class="px-3 py-4 text-muted-foreground">Nothing new. Use Watch on an automation or journey (or tick several in the list) to be told when it is paused, activated, fails or changes.</p>
        <RouterLink v-for="n in notices" :key="n.id" :to="noticeRoute(n)" class="block px-3 py-2 border-b border-border/50 hover:bg-accent" @click="open = false">
          <span class="inline-block mr-1.5 rounded px-1.5 text-[10px] font-semibold" :class="n.kind === 'fails' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : n.kind === 'paused' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-muted text-foreground'">{{ KIND[n.kind] || n.kind }}</span>
          <span class="font-medium">{{ n.name }}</span> {{ n.text }}
          <span class="block text-muted-foreground mt-0.5">{{ formatDateTime(new Date(n.at).toISOString()) }} · {{ n.stack }}</span>
        </RouterLink>
      </div>
    </template>
  </div>
</template>
