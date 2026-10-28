<script setup>
// Features page. Content lives in src/data/features.js. The To do page is hidden from
// users (feedback #77); its list stays in src/data/todo.js.
import { ref, computed } from 'vue'
import { Search } from 'lucide-vue-next'
import { FEATURE_GROUPS } from '@/data/features.js'
import CreatorCredit from '@/components/shell/CreatorCredit.vue'

defineProps({
  page: { type: String, default: 'features' },
})

const version = (() => {
  try { return chrome.runtime.getManifest().version } catch { return '' }
})()

const query = ref('')
const filteredFeatures = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return FEATURE_GROUPS
  return FEATURE_GROUPS
    .map(g => ({
      ...g,
      items: g.items.filter(f =>
        [f.title, f.how, f.detail, g.title].filter(Boolean).some(t => t.toLowerCase().includes(q))),
    }))
    .filter(g => g.items.length)
})
const featureCount = computed(() => FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0))

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="min-h-full bg-background text-foreground">
    <nav class="flex items-center gap-1 px-5 py-2 border-b border-border bg-card text-xs" aria-label="Pages">
      <RouterLink to="/features" class="px-2.5 py-1 rounded-md border" :class="page === 'features' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'">Features</RouterLink>
      <span v-if="version" class="ml-auto text-muted-foreground">Marketing Cloud Toolkit {{ version }}</span>
    </nav>

    <main class="max-w-3xl mx-auto px-5 py-6">
      <!-- Features -->
      <template v-if="page === 'features'">
        <h2 class="text-lg font-bold">Features</h2>
        <p class="text-sm text-muted-foreground mt-1">
          What Marketing Cloud Toolkit does, section by section ({{ featureCount }} features).
        </p>
        <p class="text-xs text-muted-foreground mt-1"><CreatorCredit /></p>

        <div class="relative mt-4">
          <Search class="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="query"
            type="search"
            placeholder="Search features"
            class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <nav v-if="!query" class="flex flex-wrap gap-1.5 mt-3 text-xs">
          <button v-for="g in FEATURE_GROUPS" :key="g.id" type="button" @click="scrollTo(g.id)"
            class="px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground">{{ g.title }}</button>
        </nav>

        <p v-if="!filteredFeatures.length" class="text-sm text-muted-foreground mt-6">No feature matches "{{ query }}".</p>

        <section v-for="g in filteredFeatures" :id="g.id" :key="g.id" class="mt-8 scroll-mt-16">
          <h3 class="text-base font-bold border-b border-border pb-1">{{ g.title }}</h3>
          <p v-if="g.intro" class="text-sm text-muted-foreground mt-2">{{ g.intro }}</p>
          <dl class="mt-3 space-y-4">
            <div v-for="f in g.items" :key="f.title">
              <dt class="text-sm font-semibold flex items-baseline gap-2 flex-wrap">
                {{ f.title }}
                <span v-if="f.since" class="text-[10px] font-medium px-1.5 py-px rounded-full bg-muted text-muted-foreground">new in {{ f.since }}</span>
              </dt>
              <dd class="text-sm mt-0.5">
                <span v-if="f.how" class="text-muted-foreground">{{ f.how }}. </span>{{ f.detail }}
              </dd>
            </div>
          </dl>
        </section>
      </template>

    </main>
  </div>
</template>
