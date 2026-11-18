<script setup>
// One Where used check on a page of its own (Open in new tab from the results, user
// 2026-11-18): the check named in the address (#/where-used/result?stack=..&t=<target JSON>)
// runs again here; what Where used saved for this business unit is reused.
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import UsagePanel from '@/components/usage/UsagePanel.vue'
import { useUsage, targetFromQuery } from '@/composables/useUsage.js'

const route = useRoute()
const usage = useUsage()
const asked = computed(() => targetFromQuery(route.query))
watch(asked, (a) => { if (a) usage.start(a.stack, a.target) }, { immediate: true })
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <UsagePanel v-if="asked" embedded standalone />
    <p v-else class="m-6 text-sm text-muted-foreground">This address does not name a Where used check. Open <router-link to="/where-used" class="text-primary hover:underline">Where used</router-link> and pick what to check.</p>
  </div>
</template>
