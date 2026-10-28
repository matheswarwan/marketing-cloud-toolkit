<script setup>
import { onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { saveBlob } from '@/utils/exportDoc.js'
import { showToast } from '@/composables/useToast.js'

const props = defineProps({ title: String, text: String, fileBase: { type: String, default: 'export' } })
const emit = defineEmits(['close'])

async function copy() {
  try { await navigator.clipboard.writeText(props.text); showToast('Markdown copied.') } catch { showToast('Could not copy. Select the text and copy it.') }
}
const onKey = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="emit('close')">
    <div class="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-border bg-card shadow-xl" role="dialog" aria-modal="true" :aria-label="title">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h2 class="flex-1 text-sm font-semibold truncate">{{ title }}</h2>
        <button class="p-1 rounded hover:bg-accent" title="Close" @click="emit('close')"><X class="h-4 w-4" /></button>
      </div>
      <p class="px-4 pt-2 text-xs text-muted-foreground">Markdown, ready to paste into Claude or another assistant.</p>
      <textarea class="flex-1 min-h-[40vh] m-4 p-3 rounded-md border border-border bg-background font-mono text-xs" readonly spellcheck="false" :value="text" />
      <div class="flex items-center gap-2 px-4 pb-4">
        <span class="flex-1 text-xs text-muted-foreground">{{ text.split('\n').length.toLocaleString() }} lines, {{ text.length.toLocaleString() }} characters</span>
        <button class="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs" @click="copy">Copy</button>
        <button class="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent" @click="saveBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${fileBase}.md`)">Download .md</button>
      </div>
    </div>
  </div>
</template>
