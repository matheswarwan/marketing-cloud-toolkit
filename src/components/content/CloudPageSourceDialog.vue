<script setup>
// A CloudPage's preview, source and raw asset (feedback #1010, #1011). The preview is
// a sandboxed frame without scripts; the source is read only.
import { computed, ref, watch } from 'vue'
import { X, Loader2, Copy, Download } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { fetchCloudPageSource } from '@/utils/cloudPagesApi.js'
import { saveTextFile } from '@/utils/download.js'
import { showToast } from '@/composables/useToast.js'

const props = defineProps({
  page: { type: Object, default: null },
  stack: { type: String, default: null },
})
const emit = defineEmits(['close'])

const loading = ref(false)
const error = ref('')
const src = ref(null)
const tab = ref('preview')

const isCode = computed(() => !!src.value?.language)
const text = computed(() => (isCode.value ? src.value.code : src.value?.html) || '')
const ext = computed(() => (isCode.value ? src.value.language : 'html'))
const raw = computed(() => {
  const v = src.value
  if (v?.codeResource) return JSON.stringify({ asset: v.asset, codeResource: v.codeResource }, null, 2)
  if (v?.contentAsset) return JSON.stringify({ asset: v.asset, contentAsset: v.contentAsset }, null, 2)
  return JSON.stringify(v?.asset ?? null, null, 2)
})
const tabs = computed(() => [...(isCode.value ? [] : [['preview', 'Preview']]), ['source', isCode.value ? 'Code' : 'Source'], ['raw', 'Raw JSON']])

watch(() => props.page, async (p) => {
  src.value = null
  error.value = ''
  if (!p) return
  loading.value = true
  try {
    src.value = await fetchCloudPageSource(props.stack, p)
    tab.value = src.value.language ? 'source' : 'preview'
  } catch (e) {
    error.value = `Could not read ${p.name}: ${e.message}`
  } finally {
    loading.value = false
  }
}, { immediate: true })

async function copy(value) {
  try { await navigator.clipboard.writeText(value); showToast('Copied.') } catch { showToast('The browser did not allow copying.') }
}
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml', txt: 'text/plain' }
function download() {
  const name = `${String(props.page?.name || 'cloudpage').replace(/[^\w.-]+/g, '_')}.${ext.value}`
  saveTextFile(text.value, name, MIME[ext.value] || 'text/plain', 'CloudPage source')
}
</script>

<template>
  <div v-if="page" class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="emit('close')" @keydown.esc="emit('close')">
    <div class="w-full max-w-5xl h-[85vh] rounded-lg border border-border bg-card shadow-xl flex flex-col text-sm" role="dialog" aria-modal="true" aria-labelledby="cp-src-title">
      <div class="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 id="cp-src-title" class="font-semibold truncate">{{ page.name }}</h2>
        <span class="text-xs text-muted-foreground shrink-0">{{ page.assetType }} · asset {{ page.id }}</span>
        <div class="flex-1" />
        <div v-if="src" class="flex rounded-md border border-border overflow-hidden text-xs" role="tablist">
          <button v-for="[id, label] in tabs" :key="id" role="tab" :aria-selected="tab === id" class="px-2.5 h-7" :class="tab === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'" @click="tab = id">{{ label }}</button>
        </div>
        <Button variant="ghost" size="icon" class="h-7 w-7" title="Close" @click="emit('close')"><X class="h-4 w-4" /></Button>
      </div>
      <div class="flex-1 min-h-0 flex flex-col">
        <div v-if="loading" class="m-auto flex items-center gap-2 text-muted-foreground text-xs"><Loader2 class="h-4 w-4 animate-spin" /> Reading the page…</div>
        <p v-else-if="error" class="m-4 text-xs text-red-600">{{ error }}</p>
        <template v-else-if="src">
          <p v-for="(e, i) in src.errors" :key="i" class="mx-4 mt-2 text-xs text-amber-700">{{ e }}</p>
          <template v-if="tab === 'preview'">
            <iframe v-if="text" :srcdoc="text" sandbox class="flex-1 w-full border-0 bg-white rounded-b-lg" :title="`Preview of ${page.name}`" />
            <p v-else class="m-4 text-xs text-muted-foreground">No HTML found in this page's asset. Raw JSON shows what SFMC returned.</p>
          </template>
          <template v-else>
            <div class="flex items-center gap-2 px-4 py-1.5 border-b border-border">
              <span class="text-xs text-muted-foreground flex-1">{{ tab === 'raw' ? 'The asset as SFMC returns it' : `${text.length.toLocaleString()} characters` }}</span>
              <Button variant="outline" size="sm" class="h-7 text-xs" :disabled="tab !== 'raw' && !text" @click="copy(tab === 'raw' ? raw : text)"><Copy class="h-3.5 w-3.5 mr-1" /> Copy</Button>
              <Button v-if="tab !== 'raw'" variant="outline" size="sm" class="h-7 text-xs" :disabled="!text" @click="download"><Download class="h-3.5 w-3.5 mr-1" /> .{{ ext }}</Button>
            </div>
            <pre class="flex-1 min-h-0 overflow-auto m-0 p-4 text-xs font-mono whitespace-pre-wrap break-all select-text">{{ tab === 'raw' ? raw : (text || 'No source found in this asset.') }}</pre>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>
