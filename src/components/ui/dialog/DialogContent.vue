<script setup>
import { DialogContent, DialogPortal } from 'radix-vue'
import DialogOverlay from './DialogOverlay.vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
})
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      :class="cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl bg-white shadow-2xl border border-border focus:outline-none',
        props.class
      )"
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>
