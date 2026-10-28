<script setup>
// A failed SFMC search (feedback #93): the message, Retry, and for a connection
// error a link to open the app in SFMC to log in. `error` is a string or the
// object from searchError() in utils/sfmcErrors.js.
import { computed } from 'vue'
import { RefreshCw, ExternalLink } from 'lucide-vue-next'
import { openInSfmc } from '@/utils/sfmcLinks.js'

const props = defineProps({
  error: { type: [String, Object], default: '' },
  retrying: { type: Boolean, default: false },
})
defineEmits(['retry'])
const info = computed(() => (typeof props.error === 'string' ? { message: props.error } : props.error || {}))
</script>

<template>
  <div v-if="info.message" class="mb-3 text-sm text-red-600 flex flex-wrap items-center gap-x-3 gap-y-1" role="alert">
    <span>{{ info.message }}</span>
    <button type="button" class="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50" :disabled="retrying" @click="$emit('retry')"><RefreshCw class="h-3 w-3" /> Retry</button>
    <a v-if="info.connection && info.appUrl" :href="info.appUrl" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs text-primary hover:underline" @click="openInSfmc($event, info.appUrl)"><ExternalLink class="h-3 w-3" /> Open {{ info.appName }} in SFMC to log in</a>
  </div>
</template>
