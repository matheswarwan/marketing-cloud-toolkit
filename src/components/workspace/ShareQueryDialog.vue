<script setup>
// Share a query (utils/share.js): first shows exactly what leaves the browser and a
// warning, then sends it only when the user confirms, then shows the link.
import { computed, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import { Share2, X, Copy, Check, ExternalLink, AlertTriangle, Loader2 } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { sharePayload, personalDataHints, createShareLink } from '@/utils/share.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  name: { type: String, default: '' },
  sql: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const state = ref('confirm') // confirm | sending | done | error
const url = ref('')
const error = ref('')
const copied = ref(false)
const payload = computed(() => sharePayload(props.name, props.sql))
const hints = computed(() => personalDataHints(props.sql))

watch(() => props.open, (o) => { if (o) { state.value = 'confirm'; url.value = ''; error.value = ''; copied.value = false } })

async function send() {
  state.value = 'sending'
  try {
    url.value = await createShareLink(payload.value)
    state.value = 'done'
  } catch (e) {
    error.value = e.message
    state.value = 'error'
  }
}
async function copy() {
  try { await navigator.clipboard.writeText(url.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* clipboard blocked */ }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => { if (!v && state !== 'sending') emit('close') }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-9999 bg-black/45" />
      <DialogContent class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,560px)] max-h-[85vh] rounded-xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col focus:outline-none">
        <div class="flex items-center gap-2 px-5 py-3.5 border-b border-border shrink-0">
          <Share2 class="h-4 w-4 text-primary" />
          <DialogTitle class="text-sm font-bold text-foreground">Share query</DialogTitle>
          <Button variant="ghost" size="icon" class="ml-auto h-7 w-7 text-muted-foreground" title="Close" :disabled="state === 'sending'" @click="emit('close')"><X class="h-4 w-4" /></Button>
        </div>

        <div class="px-5 py-4 flex flex-col gap-3 overflow-auto text-xs">
          <template v-if="state === 'confirm' || state === 'sending'">
            <div class="flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-amber-900 dark:text-amber-200">
              <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
              <div class="space-y-1">
                <p><b>This text leaves your browser.</b> It is sent to the share service and anyone who has the link can read it for 24 hours.</p>
                <p>Only the name and SQL below are sent: no results, no data extension rows, no account details. Remove customer data (e-mail addresses, names, IDs) from the SQL before sharing. <a href="privacy.html" target="_blank" rel="noopener" class="underline">Privacy policy</a></p>
                <p v-if="hints.length" class="font-semibold">The SQL contains {{ hints.join(' and ') }}.</p>
              </div>
            </div>
            <div>
              <div class="text-muted-foreground mb-1">Name</div>
              <div class="rounded-md border border-border bg-muted/40 px-2 py-1.5 font-medium break-all">{{ payload.name }}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-1">SQL ({{ payload.queryText.length.toLocaleString() }} characters)</div>
              <pre class="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap break-all">{{ payload.queryText }}</pre>
            </div>
          </template>
          <p v-else-if="state === 'error'" class="text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3">{{ error }}</p>
          <template v-else>
            <p class="text-muted-foreground">Anyone with this link can read and copy the SQL for 24 hours.</p>
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0 bg-muted rounded-md px-3 py-2 font-mono truncate border border-border">{{ url }}</div>
              <Button variant="outline" size="sm" class="h-8 text-xs gap-1.5 shrink-0" @click="copy"><Check v-if="copied" class="h-3 w-3" /><Copy v-else class="h-3 w-3" /> {{ copied ? 'Copied' : 'Copy' }}</Button>
            </div>
            <a :href="url" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 text-primary hover:underline self-start"><ExternalLink class="h-3 w-3" /> Open share page</a>
          </template>
        </div>

        <div class="px-5 pb-4 flex justify-end gap-2 shrink-0">
          <template v-if="state === 'confirm' || state === 'sending'">
            <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="state === 'sending'" @click="emit('close')">Cancel</Button>
            <Button size="sm" class="h-8 text-xs" :disabled="state === 'sending' || !payload.queryText.trim()" @click="send">
              <Loader2 v-if="state === 'sending'" class="h-3.5 w-3.5 mr-1 animate-spin" /> Send and create link
            </Button>
          </template>
          <Button v-else size="sm" class="h-8 text-xs" @click="emit('close')">Close</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
