<script setup>
import { useRouter } from 'vue-router'
import { ref, watch, computed } from 'vue'
import QueryEditor from '../detail/QueryEditor.vue'
import Button from '../ui/button/Button.vue'
import { buildSqlFromSelections } from '../../utils/sqlBuilder.js'
import HelpTip from '@/components/ui/HelpTip.vue'
import { BUILDER_HELP } from '@/data/builderHelp.js'
import { Copy, ExternalLink, Save, Wand2, ChevronUp, ChevronDown, Maximize2, Minimize2 } from 'lucide-vue-next'

const router = useRouter()
const props = defineProps({
  sql: { type: String, default: '' },
  selectedDEs: { type: Array, default: () => [] },
  joins: { type: Array, default: () => [] },
  where: { type: Object, default: () => ({ combinator: 'AND', conditions: [] }) },
  queryOptions: { type: Object, default: () => ({}) },
  layout: { type: Object, default: () => ({}) },
  // UNION / EXCEPT / INTERSECT: the other SELECTs, before and after this one (with their operators).
  sqlBefore: { type: String, default: '' },
  sqlAfter: { type: String, default: '' },
  visualMode: { type: Boolean, default: false },
  recordId: { type: String, default: null },
  // 'collapsed' (a bar), 'open' or 'max' (feedback #150); the builder keeps it.
  state: { type: String, default: 'open' },
})

const emit = defineEmits(['update:sql', 'save', 'apply-sql', 'state'])

const localSql = ref(props.sql)
// The SQL the builder last generated; when the editor differs, the user edited it
// and can draw their version (Apply to builder).
const generated = ref('')
const edited = computed(() => localSql.value.trim() !== generated.value.trim())
const copied = ref(false)

// List and Visual draw the same model, so one generator serves both.
watch(() => [props.selectedDEs, props.joins, props.where, props.queryOptions, props.sqlBefore, props.sqlAfter], () => {
  const own = buildSqlFromSelections(props.selectedDEs, props.joins, props.where, props.queryOptions)
  localSql.value = [props.sqlBefore, own, props.sqlAfter].filter((x) => x && x.trim()).join('\n')
  generated.value = localSql.value
  emit('update:sql', localSql.value)
}, { deep: true, immediate: true })

function onEdit(v) {
  localSql.value = v
  emit('update:sql', v)
}

async function copySql() {
  await navigator.clipboard.writeText(localSql.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

// Save goes through the builder, which knows every SELECT of a UNION.
function saveToQuerySaver() {
  emit('save')
}

function openInWorkspace() {
  router.push({ path: '/queries/workspace', query: { sql: localSql.value } })
}
</script>

<template>
  <div class="sql-output flex flex-col h-full">
    <div class="px-3 py-1.5 flex items-center gap-2 shrink-0 bg-card" :class="state === 'collapsed' ? '' : 'border-b border-border'">
      <button class="flex items-center gap-1 text-xs font-bold text-muted-foreground uppercase hover:text-foreground" :title="state === 'collapsed' ? 'Show the SQL' : 'Minimize'" @click="emit('state', state === 'collapsed' ? 'open' : 'collapsed')">
        <ChevronUp v-if="state === 'collapsed'" class="h-3.5 w-3.5" /><ChevronDown v-else class="h-3.5 w-3.5" /> Generated SQL
        <span v-if="state === 'collapsed'" class="ml-1 normal-case font-normal">{{ localSql.split('\n').length }} lines</span>
      </button>
      <HelpTip topic="sql" :topics="BUILDER_HELP" />
      <div class="flex gap-1 ml-auto">
        <Button v-if="edited" size="sm" class="h-7 text-[10px]" title="Redraw the builder from this SQL (your edits otherwise vanish on the next change)" @click="emit('apply-sql', localSql)">
          <Wand2 class="h-3 w-3 mr-1" /> Apply to builder
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-[10px]" @click="copySql">
          <Copy class="h-3 w-3 mr-1" />{{ copied ? 'Copied!' : 'Copy' }}
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-[10px]" @click="saveToQuerySaver">
          <Save class="h-3 w-3 mr-1" /> Save
        </Button>
        <Button size="sm" class="h-7 text-[10px] bg-[#0176D3] text-white" :disabled="!localSql.trim()" @click="openInWorkspace">
          <ExternalLink class="h-3 w-3 mr-1" /> Run query
        </Button>
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :title="state === 'collapsed' ? 'Show' : 'Minimize'" @click="emit('state', state === 'collapsed' ? 'open' : 'collapsed')">
          <ChevronUp v-if="state === 'collapsed'" class="h-3.5 w-3.5" /><ChevronDown v-else class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :title="state === 'max' ? 'Restore' : 'Maximize'" @click="emit('state', state === 'max' ? 'open' : 'max')">
          <Minimize2 v-if="state === 'max'" class="h-3.5 w-3.5" /><Maximize2 v-else class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <div v-show="state !== 'collapsed'" class="flex-1 min-h-0 overflow-hidden">
      <QueryEditor :modelValue="localSql" @update:modelValue="onEdit" />
    </div>
  </div>
</template>
