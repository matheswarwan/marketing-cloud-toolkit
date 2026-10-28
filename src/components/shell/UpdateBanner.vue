<script setup>
// Shown when Chrome has downloaded a newer Marketing Cloud Toolkit that waits for the
// extension to restart (see background/updates.js, feedback #48).
import { onMounted, onUnmounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'

const UPDATE_KEY = '_updateAvailable'
const waiting = ref(null)
let current = ''
try { current = chrome.runtime.getManifest().version } catch { /* not in an extension */ }

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}
const apply = (v) => { waiting.value = v?.version && newer(v.version, current) ? v.version : null }
const onChange = (changes, area) => { if (area === 'local' && UPDATE_KEY in changes) apply(changes[UPDATE_KEY].newValue) }

onMounted(() => {
  try {
    chrome.storage.local.get(UPDATE_KEY, (r) => apply(r?.[UPDATE_KEY]))
    chrome.storage.onChanged.addListener(onChange)
  } catch { /* not in an extension */ }
})
onUnmounted(() => { try { chrome.storage.onChanged.removeListener(onChange) } catch { /* ignore */ } })

function restart() {
  if (!window.confirm(`Restart Marketing Cloud Toolkit to update to ${waiting.value}?\n\nMarketing Cloud Toolkit tabs close; open it again from the toolbar. A query already running keeps running in SFMC.`)) return
  chrome.runtime.reload()
}
</script>

<template>
  <div v-if="waiting" class="fixed bottom-4 right-4 z-140 flex items-center gap-3 max-w-sm rounded-lg border border-primary/40 bg-card shadow-xl px-3 py-2 text-xs" role="status">
    <span class="flex-1">Marketing Cloud Toolkit {{ waiting }} is ready. Restart to start using it.</span>
    <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground font-medium" @click="restart">
      <RefreshCw class="h-3.5 w-3.5" /> Restart to update
    </button>
  </div>
</template>
