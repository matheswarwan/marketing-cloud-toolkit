<script setup>
// Preview data as a page (feedback #1097): the DE comes from the address
// (?id=&key=&name=&source=), so the preview can open in its own tab and stays put.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DERowsViewer from '@/components/data/DERowsViewer.vue'
import { useStack } from '@/composables/useStack.js'
import { Loader2 } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { stack } = useStack()

const de = computed(() => {
  const q = route.query
  const one = (v) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '')
  const source = one(q.source)
  return {
    id: one(q.id),
    customerKey: one(q.key),
    name: one(q.name) || one(q.key),
    // The DE list sends 'sync', the data model 'synchronized' (#1120: 'sync' used to be dropped).
    sourceType: source === 'shared' ? 'shared' : source === 'sync' || source === 'synchronized' ? 'sync' : null,
  }
})
const newTabHref = computed(() => {
  const href = router.resolve({ path: route.path, query: route.query }).href
  return typeof location !== 'undefined' ? `${location.origin}${location.pathname}${href}` : href
})

// Back to Data Extensions; a tab opened on its own has no history to go back to.
function back() {
  if (window.history.state?.back) router.back()
  else router.push('/data-extensions')
}
</script>

<template>
  <div class="h-[calc(100vh-5.5rem)] min-h-[420px] p-4">
    <p v-if="!de.customerKey" class="text-sm text-muted-foreground">No data extension named in the address. Open Preview data from <RouterLink to="/data-extensions" class="text-primary hover:underline">Data Extensions</RouterLink>.</p>
    <div v-else-if="!stack" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" /> Connecting to SFMC…</div>
    <DERowsViewer v-else :key="`${stack}:${de.customerKey}`" page :stack="stack" :de="de" :new-tab-href="newTabHref" @close="back" />
  </div>
</template>
