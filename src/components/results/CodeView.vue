<script setup>
// Read-only code block with SQL or JavaScript (SSJS) highlighting, in place of
// Automation Viewer's Ace editors.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { sql, MSSQL } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { Copy } from 'lucide-vue-next'
import { showToast } from '@/composables/useToast.js'

const props = defineProps({
  code: { type: String, default: '' },
  lang: { type: String, default: 'sql' }, // sql | javascript | text
  maxHeight: { type: String, default: '420px' },
})
const host = ref(null)
let view = null

function extensions() {
  const lang = props.lang === 'sql' ? [sql({ dialect: MSSQL })] : props.lang === 'javascript' ? [javascript()] : []
  return [lineNumbers(), oneDark, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, ...lang,
    EditorView.theme({ '&': { fontSize: '12px', maxHeight: props.maxHeight }, '.cm-scroller': { overflow: 'auto' } })]
}

onMounted(() => { view = new EditorView({ parent: host.value, state: EditorState.create({ doc: props.code, extensions: extensions() }) }) })
watch(() => [props.code, props.lang], () => view?.setState(EditorState.create({ doc: props.code, extensions: extensions() })))
onBeforeUnmount(() => view?.destroy())

async function copy() {
  try { await navigator.clipboard.writeText(props.code); showToast('Copied.') } catch { showToast('Could not copy.') }
}
</script>

<template>
  <div class="relative rounded-md overflow-hidden border border-border">
    <button class="absolute right-2 top-2 z-10 p-1 rounded bg-slate-700/80 text-slate-200 hover:bg-slate-600" title="Copy" @click="copy"><Copy class="h-3.5 w-3.5" /></button>
    <div ref="host" />
  </div>
</template>
