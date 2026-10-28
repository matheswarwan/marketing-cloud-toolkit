<script setup>
import { ref, computed } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'radix-vue'
import { Copy, Check, ExternalLink, X, Share2, Blocks } from 'lucide-vue-next'
import ShareQueryDialog from '@/components/workspace/ShareQueryDialog.vue'
import { SHARE_SETTING, shareAllowed } from '@/utils/share.js'
import { useStoredSetting } from '@/composables/useStoredSetting.js'

const props = defineProps({
  card: { type: Object, required: true },
})

const emit = defineEmits(['close', 'open-editor', 'open-builder'])

const copied = ref(false)

const humanReadableDate = computed(() =>
  props.card.timeStamp ? new Date(props.card.timeStamp).toLocaleString() : 'Unknown date'
)
const displayName = computed(() => props.card.name ?? humanReadableDate.value)
const sql = computed(() => props.card.queryText || '')

async function copySql() {
  try {
    await navigator.clipboard.writeText(sql.value)
  } catch {
    // Fallback for environments without the async clipboard API
    const ta = document.createElement('textarea')
    ta.value = sql.value
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    document.body.removeChild(ta)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

// ── Share ─────────────────────────────────────────────────
// Only when turned on in Settings and allowed by policy; the dialog shows what is sent.
const shareOpen = ref(false)
const { value: shareSetting } = useStoredSetting(SHARE_SETTING, false, (v) => v === true)
const canShare = computed(() => shareAllowed(shareSetting.value) && !!sql.value.trim())
</script>

<template>
  <DialogRoot :open="true" @update:open="(v) => { if (!v) emit('close') }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-9998 bg-black/50" />

      <DialogContent
        class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,720px)] max-h-[min(70vh,640px)] rounded-xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden focus:outline-none"
        @click.stop
      >
        <!-- Header: the title row keeps Close visible; the actions wrap below it on narrow windows (feedback #1005). -->
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-5 pr-12 py-3 bg-muted/30 border-b border-border shrink-0">
          <button
            class="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
          <div class="min-w-0 flex-1 basis-56 flex flex-col gap-0.5">
            <DialogTitle class="text-[15px] font-bold text-foreground truncate">{{ displayName }}</DialogTitle>
            <div class="flex items-center gap-2 min-w-0">
              <span v-if="card.businessUnit?.name"
                class="inline-block text-[10px] font-semibold text-primary bg-primary/10 border border-primary/30 rounded-full px-2 py-px truncate max-w-[220px]"
                :title="`BU: ${card.businessUnit.name} (${card.businessUnit.accountId})`">
                {{ card.businessUnit.name }}
              </span>
              <span class="text-[11px] text-muted-foreground truncate">{{ humanReadableDate }}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canShare"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors"
              title="Share: create a link anyone can open for 24 hours (you see what is sent first)"
              @click="shareOpen = true"
            >
              <Share2 class="h-3.5 w-3.5" />
              Share
            </button>
            <button
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border transition-colors"
              :class="copied
                ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-700'
                : 'border-border text-foreground hover:bg-muted'"
              @click="copySql"
            >
              <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
              {{ copied ? 'Copied' : 'Copy SQL' }}
            </button>
            <button
              v-if="card.source !== 'builder' && (card.queryText || '').trim()"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors"
              title="Draw this query as tables and joins in the Query Builder"
              @click="emit('open-builder', card)"
            >
              <Blocks class="h-3.5 w-3.5" />
              Open in Query Builder
            </button>
            <button
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Open in the full editor to validate or run this query"
              @click="emit('open-editor', card.id)"
            >
              <ExternalLink class="h-3.5 w-3.5" />
              Open in editor
            </button>
          </div>
        </div>

        <!-- SQL body -->
        <div class="flex-1 overflow-auto bg-[#0f172a] p-4">
          <pre class="font-mono text-[12.5px] leading-relaxed text-slate-200 whitespace-pre-wrap wrap-break-word m-0 select-text">{{ sql }}</pre>
        </div>
      </DialogContent>
    </DialogPortal>
    <ShareQueryDialog :open="shareOpen" :name="displayName" :sql="sql" @close="shareOpen = false" />
  </DialogRoot>
</template>
