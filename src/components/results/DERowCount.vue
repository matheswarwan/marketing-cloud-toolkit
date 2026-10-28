<script setup>
import { ref, watch } from 'vue'
import { useStack } from '@/composables/useStack.js'
import { rowCountFor } from '@/utils/deRowCounts.js'

// "12,345 rows" next to a data extension's name (feedback #72). Nothing while it
// loads or when the count cannot be read.
const props = defineProps({
  name: { type: String, default: '' },
  id:   { type: [String, Number], default: null },
})

const { stack } = useStack()
const count = ref(null)
let seq = 0

watch(() => [stack.value, props.id, props.name], async ([s, id, name]) => {
  const mine = ++seq
  count.value = null
  if (!s || (!id && !name)) return
  const n = await rowCountFor(s, { id, name })
  if (mine === seq) count.value = n
}, { immediate: true })
</script>

<template>
  <span v-if="count !== null" class="ml-1.5 text-[11px] text-muted-foreground whitespace-nowrap" :title="`${count.toLocaleString()} rows in this data extension`">{{ count.toLocaleString() }} {{ count === 1 ? 'row' : 'rows' }}</span>
</template>
