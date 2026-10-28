<script setup>
import { useToast } from '@/composables/useToast.js'
const { toast } = useToast()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast" :key="toast.id" role="status"
      class="fixed bottom-5 left-1/2 -translate-x-1/2 z-200 max-w-[90vw] rounded-lg bg-slate-800 text-slate-50 px-4 py-2.5 text-sm font-medium shadow-xl">
      {{ toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
</style>
