<script setup>
// Read-only side-by-side diff in the same editor look as CodeView (feedback #1015):
// CodeMirror's MergeView with SQL or JavaScript highlighting, line numbers, changed
// words marked inside changed lines and long unchanged stretches folded.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { MergeView } from '@codemirror/merge'
import { sql, MSSQL } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps({
  left: { type: String, default: '' },
  right: { type: String, default: '' },
  lang: { type: String, default: 'sql' }, // sql | javascript | text
})
const host = ref(null)
let view = null

function extensions() {
  const lang = props.lang === 'sql' ? [sql({ dialect: MSSQL })] : props.lang === 'javascript' ? [javascript()] : []
  return [lineNumbers(), oneDark, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, ...lang,
    EditorView.theme({ '&': { fontSize: '12px' } })]
}

function build() {
  view?.destroy()
  view = new MergeView({
    parent: host.value,
    a: { doc: props.left, extensions: extensions() },
    b: { doc: props.right, extensions: extensions() },
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  })
}

onMounted(build)
watch(() => [props.left, props.right, props.lang], build)
onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="diff-view rounded-md overflow-hidden border border-border" aria-label="Changes" />
</template>

<style scoped>
.diff-view :deep(.cm-mergeView) { background: #282c34; }
.diff-view :deep(.cm-collapsedLines) { background: #21252b; color: #abb2bf; }
</style>
