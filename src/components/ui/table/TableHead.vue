<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <th :class="cn('h-9 px-3 text-left align-middle text-xs font-semibold text-muted-foreground bg-muted/60 border-r border-border last:border-r-0 sticky top-0 whitespace-nowrap', props.class)"><slot /></th>
</template>
