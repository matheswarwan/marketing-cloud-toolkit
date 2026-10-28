<script setup>
// Download menu shared by the result screens (from SFMC Automation Viewer):
// View as Markdown, Copy as Markdown, Markdown, Word, PDF (print dialog) and HTML files.
// `getDoc` returns the document described in utils/exportDoc.js (it may fetch).
import { ref } from 'vue'
import { Download, ChevronDown, Loader2 } from 'lucide-vue-next'
import MarkdownModal from './MarkdownModal.vue'
import { toMarkdown, toHtml, toDocxBlob, saveBlob, printDoc } from '@/utils/exportDoc.js'
import { showToast } from '@/composables/useToast.js'
import { useStack } from '@/composables/useStack.js'
import { exportBaseName } from '@/utils/exportName.js'

const props = defineProps({
  getDoc: { type: Function, required: true },
  fileName: { type: String, default: 'export' },
  disabled: { type: Boolean, default: false },
  label: { type: String, default: 'Download' },
})

const { stack } = useStack()
const open = ref(false)
const busy = ref(false)
const markdown = ref(null) // { title, text } while the viewer is open

async function run(kind) {
  open.value = false
  busy.value = true
  try {
    const doc = await props.getDoc()
    const base = await exportBaseName(stack.value, props.fileName)
    if (kind === 'view') markdown.value = { title: doc.title, text: toMarkdown(doc), base }
    else if (kind === 'copy') {
      await navigator.clipboard.writeText(toMarkdown(doc))
      showToast('Markdown copied.')
    } else if (kind === 'md') saveBlob(new Blob([toMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`)
    else if (kind === 'html') saveBlob(new Blob([toHtml(doc)], { type: 'text/html;charset=utf-8' }), `${base}.html`)
    else if (kind === 'docx') saveBlob(await toDocxBlob(doc), `${base}.docx`)
    else if (kind === 'pdf') printDoc({ ...doc, title: doc.title || base })
  } catch (e) {
    showToast(`Could not export: ${e.message}`)
  } finally {
    busy.value = false
  }
}

const ITEMS = [
  { kind: 'view', label: 'View as Markdown' },
  { kind: 'copy', label: 'Copy as Markdown' },
  { kind: 'md', label: 'Markdown (.md)' },
  { kind: 'docx', label: 'Word (.docx)' },
  { kind: 'pdf', label: 'PDF (print, Save as PDF)' },
  { kind: 'html', label: 'HTML (.html)' },
]
</script>

<template>
  <div class="relative">
    <button class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-accent disabled:opacity-50"
      :disabled="disabled || busy" :aria-expanded="open" @click="open = !open">
      <Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" /><Download v-else class="h-3.5 w-3.5" />
      {{ label }} <ChevronDown class="h-3 w-3 text-muted-foreground" />
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-40" @click="open = false" />
      <div class="absolute right-0 mt-1 w-48 z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1" role="menu">
        <button v-for="item in ITEMS" :key="item.kind" role="menuitem"
          class="w-full text-left px-3 py-1.5 text-xs hover:bg-accent" @click="run(item.kind)">{{ item.label }}</button>
      </div>
    </template>
    <MarkdownModal v-if="markdown" :title="markdown.title" :text="markdown.text" :file-base="markdown.base" @close="markdown = null" />
  </div>
</template>
