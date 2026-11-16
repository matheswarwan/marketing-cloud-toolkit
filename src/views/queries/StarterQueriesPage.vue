<script setup>
// Queries > Starter queries (user, 2026-11-16; idea from VeLens's Query Library): ready-made
// SQL over SFMC's data views, by category, to open in Run Query or copy. The SQL is ours
// (data/starterQueries.js) and passes the Toolkit's lint.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Play, Copy, Check } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import CodeView from '@/components/results/CodeView.vue'
import { STARTER_QUERIES, STARTER_CATEGORIES } from '@/data/starterQueries.js'
import { showToast } from '@/composables/useToast.js'
import { useRouteSearch } from '@/composables/useRouteSearch.js'

const router = useRouter()
const text = ref('')
const category = ref('')
const copied = ref('')
useRouteSearch('/queries/starter', (q) => { text.value = q; category.value = '' })

const shown = computed(() => {
  const words = text.value.toLowerCase().split(/\s+/).filter(Boolean)
  return STARTER_QUERIES.filter((q) => (!category.value || q.category === category.value)
    && words.every((w) => `${q.title} ${q.purpose} ${q.notes || ''} ${q.sql}`.toLowerCase().includes(w)))
})
const groups = computed(() => STARTER_CATEGORIES.map((c) => ({ name: c, items: shown.value.filter((q) => q.category === c) })).filter((g) => g.items.length))

function open(q) { router.push({ path: '/queries/workspace', query: { sql: q.sql } }) }
async function copy(q) {
  try {
    await navigator.clipboard.writeText(q.sql)
    copied.value = q.id
    setTimeout(() => { if (copied.value === q.id) copied.value = '' }, 1500)
  } catch { showToast('Could not copy. Select the SQL and copy it instead.') }
}
</script>

<template>
  <div class="p-4 space-y-4 max-w-5xl">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold">Starter queries</h1>
      <span class="text-xs text-muted-foreground">Ready-made SQL over SFMC's data views. Open one in Run Query, change the dates or names, and run it. Data views keep about six months of tracking.</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[220px] max-w-md">
        <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="text" class="pl-9 rounded-full" placeholder="Search: bounces, journey, unsubscribe…" aria-label="Search starter queries" />
      </div>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        <button v-for="c in ['', ...STARTER_CATEGORIES]" :key="c" type="button" class="h-7 px-3 rounded-full border text-xs" :aria-pressed="category === c"
          :class="category === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'" @click="category = c">{{ c || 'All' }}</button>
      </div>
    </div>
    <p v-if="!groups.length" class="text-sm text-muted-foreground">No starter query matches.</p>
    <section v-for="g in groups" :key="g.name" class="space-y-2">
      <h2 class="text-sm font-semibold">{{ g.name }} <span class="font-normal text-muted-foreground">({{ g.items.length }})</span></h2>
      <article v-for="q in g.items" :key="q.id" class="rounded-lg border border-border bg-card p-3 space-y-2" :data-starter="q.id">
        <div class="flex flex-wrap items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold">{{ q.title }}</div>
            <div class="text-xs text-muted-foreground">{{ q.purpose }}</div>
            <div v-if="q.notes" class="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{{ q.notes }}</div>
          </div>
          <Button size="sm" class="gap-1" data-starter-open @click="open(q)"><Play class="h-3.5 w-3.5" /> Open in Run Query</Button>
          <Button size="sm" variant="outline" class="gap-1" :aria-label="`Copy the SQL of ${q.title}`" @click="copy(q)"><Check v-if="copied === q.id" class="h-3.5 w-3.5" /><Copy v-else class="h-3.5 w-3.5" /> {{ copied === q.id ? 'Copied' : 'Copy' }}</Button>
        </div>
        <CodeView :code="q.sql" lang="sql" max-height="220px" />
      </article>
    </section>
  </div>
</template>
