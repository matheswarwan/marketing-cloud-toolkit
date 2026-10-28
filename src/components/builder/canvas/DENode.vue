<script setup>
// One data extension or data view on the visual Query Builder canvas: header with the
// alias, name and actions; a row per field with a tick (output), key and type icons,
// and a connection handle on each side (drag one onto a field of another card to join).
import { computed, inject, nextTick, ref, watch } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import {
  Loader2, KeyRound, Type, Hash, Calendar, Mail, Phone, ToggleLeft, Globe, X, Search, Crown, Filter, Pencil,
} from 'lucide-vue-next'
import { visibleRows, fieldHandle, headerHandle, ROW_H, HEADER_H } from '@/utils/builderCanvas.js'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
})

const canvas = inject('builderCanvas')
const { updateNodeInternals } = useVueFlow()

const showAll = ref(false)
const search = ref('')
const searching = ref(false)

const de = computed(() => props.data.de)
const joined = computed(() => new Set(props.data.joined || []))
const view = computed(() => visibleRows(de.value, joined.value, { showAll: showAll.value, search: search.value }))
const loading = computed(() => !de.value.fields?.length && !de.value.fieldsLoaded)
const isFrom = computed(() => props.data.index === 0)
const filtered = computed(() => new Set(props.data.filtered || []))
const isSub = computed(() => de.value.sourceType === 'subquery')
const sourceLabel = computed(() => {
  if (isSub.value) return 'Subquery'
  if (de.value.missing) return 'Not found'
  return de.value.isDataView || de.value.sourceType === 'dataview' ? 'Data view' : (de.value.sourceType || 'DE')
})

// Rows moved without the card changing size: tell Vue Flow where the handles are now.
watch(() => view.value.rows.map((r) => r.index).join(','), () => nextTick(() => updateNodeInternals([props.id])))

function typeIcon(f) {
  const t = String(f?.type ?? f?.fieldType ?? '').toLowerCase()
  if (t.includes('email')) return Mail
  if (t.includes('phone')) return Phone
  if (t.includes('date')) return Calendar
  if (t.includes('bool')) return ToggleLeft
  if (t.includes('number') || t.includes('decimal') || t.includes('int')) return Hash
  if (t.includes('locale')) return Globe
  return Type
}
const isKey = (f) => !!(f?.isPrimaryKey || f?.isKey || f?.primaryKey)
const ticked = (name) => de.value.selectedFields === null || (de.value.selectedFields || []).includes(name)
const tickCount = computed(() => de.value.selectedFields === null ? (de.value.fields || []).length : (de.value.selectedFields || []).length)

function toggleSearch() {
  searching.value = !searching.value
  if (!searching.value) search.value = ''
}
</script>

<template>
  <div
    class="de-node w-[240px] rounded-lg border bg-card text-card-foreground shadow-md"
    :class="[isFrom ? 'border-primary' : 'border-border', isSub ? 'border-dashed' : '', de.missing ? 'opacity-80' : '']"
  >
    <Handle :id="headerHandle('l')" type="source" :position="Position.Left" class="de-handle de-handle-hdr" :style="{ top: HEADER_H / 2 + 'px' }" />
    <Handle :id="headerHandle('r')" type="source" :position="Position.Right" class="de-handle de-handle-hdr" :style="{ top: HEADER_H / 2 + 'px' }" />

    <div class="de-node-header flex items-center gap-1.5 px-2 border-b border-border rounded-t-lg cursor-move"
      :class="isFrom ? 'bg-primary/10' : 'bg-muted/40'" :style="{ height: HEADER_H + 'px' }">
      <span class="text-[10px] font-mono text-primary border border-primary/40 rounded px-1 shrink-0" :title="isFrom ? 'Alias. This is the FROM table' : 'Alias'">{{ data.alias }}</span>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-bold truncate" :title="de.name">{{ de.name }}</div>
        <div class="text-[9px] text-muted-foreground truncate">
          <template v-if="isFrom">FROM · </template>{{ sourceLabel }} · {{ tickCount }} of {{ (de.fields || []).length }} out
        </div>
      </div>
      <button v-if="isSub" class="nodrag p-0.5 rounded text-muted-foreground hover:text-foreground" title="Edit the subquery's SQL" @click="canvas.editSubquery(id)"><Pencil class="h-3 w-3" /></button>
      <button class="nodrag p-0.5 rounded text-muted-foreground hover:text-foreground" title="Search fields" @click="toggleSearch"><Search class="h-3 w-3" /></button>
      <button v-if="!isFrom" class="nodrag p-0.5 rounded text-muted-foreground hover:text-foreground" title="Make this the FROM table" @click="canvas.makeFrom(id)"><Crown class="h-3 w-3" /></button>
      <button class="nodrag p-0.5 rounded text-muted-foreground hover:text-destructive" title="Remove from the query" @click="canvas.remove(id)"><X class="h-3.5 w-3.5" /></button>
    </div>

    <div v-if="searching" class="nodrag px-2 py-1 border-b border-border">
      <input v-model="search" class="w-full h-6 text-[11px] px-1.5 rounded border border-border bg-background" placeholder="Find a field" @keydown.esc="toggleSearch" />
    </div>

    <div v-if="loading" class="flex items-center gap-1 px-2 text-[10px] text-muted-foreground" :style="{ height: ROW_H + 'px' }">
      <Loader2 class="h-3 w-3 animate-spin" /> Loading fields…
    </div>
    <div v-else-if="!view.rows.length" class="px-2 text-[10px] italic text-muted-foreground flex items-center" :style="{ height: ROW_H + 'px' }">
      {{ search ? 'No field matches' : 'No fields' }}
    </div>
    <div
      v-for="r in view.rows"
      :key="r.index"
      class="de-row relative flex items-center gap-1.5 px-2 text-[11px] hover:bg-muted/60"
      :class="joined.has(r.field.name) ? 'font-semibold' : ''"
      :style="{ height: ROW_H + 'px' }"
    >
      <Handle :id="fieldHandle(r.index, 'l')" type="source" :position="Position.Left" class="de-handle" />
      <input type="checkbox" class="nodrag h-3 w-3 shrink-0" :checked="ticked(r.field.name)" :title="ticked(r.field.name) ? 'In the output. Untick to leave out' : 'Tick to add to the output'" @change="canvas.toggleField(id, r.field.name)" />
      <KeyRound v-if="isKey(r.field)" class="h-3 w-3 text-amber-500 shrink-0" />
      <component :is="typeIcon(r.field)" v-else class="h-3 w-3 text-muted-foreground shrink-0" />
      <span class="truncate flex-1" :title="r.field.name">{{ r.field.name }}</span>
      <Filter v-if="filtered.has(r.field.name)" class="h-2.5 w-2.5 text-primary shrink-0" title="Used in a filter" />
      <button class="nodrag de-row-action text-[9px] text-primary opacity-0 hover:underline shrink-0" title="Add a filter on this field" @click="canvas.addFilter(id, r.field.name)">filter</button>
      <Handle :id="fieldHandle(r.index, 'r')" type="source" :position="Position.Right" class="de-handle" />
    </div>

    <div v-if="view.hidden || showAll" class="nodrag flex items-center px-2 border-t border-border text-[10px]" style="height: 26px">
      <button class="text-primary hover:underline" @click="showAll = !showAll">
        {{ showAll ? 'Show fewer fields' : `Show all ${(de.fields || []).length} fields (${view.hidden} hidden)` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.de-row:hover .de-row-action { opacity: 1; }
</style>
