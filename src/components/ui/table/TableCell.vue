<script setup>
import { cn } from '@/lib/utils'
const props = defineProps({ class: { type: String, default: '' } })
</script>
<template>
  <td :class="cn('px-3 py-2 align-middle text-xs text-foreground border-r border-border/50 last:border-r-0', props.class)"><slot /></td>
</template>
