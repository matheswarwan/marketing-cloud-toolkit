<script setup>
// Query Builder section. Kept alive while you visit other sections; `?id=` opens a
// saved Query Builder query, New starts an empty one.
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FilePlus2 } from 'lucide-vue-next'
import QueryBuilder from '@/components/builder/QueryBuilder.vue'
import Button from '@/components/ui/button/Button.vue'
import { claim, release, isClaimedElsewhere } from '@/utils/tabClaims.js'

const LAST_BUILDER_KEY = 'toolkit_lastBuilder'

const route = useRoute()
const router = useRouter()
const openId = ref(null)
const importSql = ref('') // ?sql= : draw this query in a new builder
const session = ref(0) // a new value remounts the builder

function open(id, sql = '') {
  release(openId.value)
  openId.value = id
  importSql.value = sql
  claim(id)
  session.value++
}

function onSaved(id) {
  release(openId.value)
  openId.value = id
  claim(id)
  chrome.storage.local.set({ [LAST_BUILDER_KEY]: id })
}

function startNew() {
  chrome.storage.local.remove(LAST_BUILDER_KEY)
  open(null)
}

// First visit: the query asked for, else the one you were last building.
const first = typeof route.query.id === 'string' ? route.query.id : null
const firstSql = typeof route.query.sql === 'string' ? route.query.sql : ''
if (firstSql) { chrome.storage.local.remove(LAST_BUILDER_KEY); open(null, firstSql) }
else if (first) open(first)
// (Skipped when another tab is building it, so two tabs never save over each other.)
else {
  chrome.storage.local.get(LAST_BUILDER_KEY, async (r) => {
    const last = r?.[LAST_BUILDER_KEY]
    if (last && !(await isClaimedElsewhere(last))) open(last)
    else open(null)
  })
}

watch(() => route.query.id, (id) => {
  if (route.path !== '/queries/builder' || typeof id !== 'string') return
  if (id !== openId.value) open(id)
  router.replace({ path: route.path })
})
// Open in Query Builder (Run Query, Saved queries): a new builder drawn from the SQL.
watch(() => route.query.sql, (sql) => {
  if (route.path !== '/queries/builder' || typeof sql !== 'string' || !sql.trim()) return
  chrome.storage.local.remove(LAST_BUILDER_KEY)
  open(null, sql)
  router.replace({ path: route.path })
})
if (first || firstSql) router.replace({ path: route.path })
</script>

<template>
  <QueryBuilder v-if="session" :key="session" :open-id="openId" :import-sql="importSql" @saved="onSaved">
    <template #actions>
      <Button variant="ghost" size="sm" class="h-8 text-xs" title="Start a new query; this one stays saved" @click="startNew">
        <FilePlus2 class="h-3.5 w-3.5 mr-1" /> New query
      </Button>
    </template>
  </QueryBuilder>
</template>
