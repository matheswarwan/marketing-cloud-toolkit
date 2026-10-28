<script setup>
// The query's output columns in order: move them, rename them (AS) or take them out.
// Ticked fields keep their name in the DE's `fieldAliases`; the order is
// `queryOptions.columnOrder` (column keys from sqlBuilder).
import { computed } from 'vue'
import { ArrowUp, ArrowDown, X } from 'lucide-vue-next'
import { selectListItems, computedKey } from '@/utils/sqlBuilder.js'

const props = defineProps({
  selectedDEs: { type: Array, default: () => [] },
  queryOptions: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:selectedDEs', 'update:queryOptions'])

const items = computed(() => selectListItems(props.selectedDEs, props.queryOptions || {}).map((it) => {
  const [kind, ...rest] = it.key.split(':')
  const source = it.sql.replace(/\s+AS\s+\[[^\]]*\]$/i, '')
  if (kind === 'c') {
    const deId = rest[0]
    const field = rest.slice(1).join(':')
    const de = props.selectedDEs.find((d) => d.id === deId)
    return { ...it, kind, deId, field, source, as: de?.fieldAliases?.[field] || '' }
  }
  if (kind === 'x') {
    const list = props.queryOptions?.computedColumns || []
    const index = list.findIndex((c, i) => computedKey(c, i) === it.key)
    return { ...it, kind, index, source, as: list[index]?.alias || '' }
  }
  return { ...it, kind, source, as: '' }
}))

function move(i, d) {
  const keys = items.value.map((x) => x.key)
  const j = i + d
  if (j < 0 || j >= keys.length) return
  ;[keys[i], keys[j]] = [keys[j], keys[i]]
  emit('update:queryOptions', { ...props.queryOptions, columnOrder: keys })
}

function rename(it, value) {
  const v = value.trim()
  if (it.kind === 'c') {
    emit('update:selectedDEs', props.selectedDEs.map((de) => {
      if (de.id !== it.deId) return de
      const aliases = { ...(de.fieldAliases || {}) }
      if (v && v !== it.field) aliases[it.field] = v
      else delete aliases[it.field]
      return { ...de, fieldAliases: aliases }
    }))
  } else if (it.kind === 'x') {
    const list = (props.queryOptions.computedColumns || []).map((c, i) => (i === it.index ? { ...c, alias: v } : c))
    emit('update:queryOptions', { ...props.queryOptions, computedColumns: list })
  }
}

function remove(it) {
  if (it.kind === 'c') {
    emit('update:selectedDEs', props.selectedDEs.map((de) => {
      if (de.id !== it.deId) return de
      const all = (de.fields || []).map((f) => f.name)
      const cur = de.selectedFields === null ? all : de.selectedFields || []
      return { ...de, selectedFields: cur.filter((n) => n !== it.field) }
    }))
  } else if (it.kind === 'x') {
    emit('update:queryOptions', { ...props.queryOptions, computedColumns: (props.queryOptions.computedColumns || []).filter((_, i) => i !== it.index) })
  }
}
</script>

<template>
  <div class="space-y-0.5">
    <div v-if="!items.length" class="text-[10px] text-muted-foreground">No output columns yet: tick fields or add a computed column.</div>
    <div v-for="(it, i) in items" :key="it.key" class="flex items-center gap-1 text-[10px]">
      <span class="w-5 text-right text-muted-foreground shrink-0">{{ i + 1 }}</span>
      <span class="flex-1 min-w-0 truncate font-mono" :title="it.source">{{ it.source }}</span>
      <span v-if="it.kind !== 's'" class="text-[9px] text-muted-foreground shrink-0">AS</span>
      <input
        v-if="it.kind !== 's'"
        class="w-28 min-w-0 font-mono border rounded px-1 py-0.5 bg-background"
        :value="it.as"
        :placeholder="it.name"
        title="Output column name"
        @change="rename(it, $event.target.value)"
      />
      <button class="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="i === 0" title="Move up" @click="move(i, -1)"><ArrowUp class="h-3 w-3" /></button>
      <button class="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="i === items.length - 1" title="Move down" @click="move(i, 1)"><ArrowDown class="h-3 w-3" /></button>
      <button v-if="it.kind !== 's'" class="p-0.5 rounded text-muted-foreground hover:text-destructive" title="Leave out of the output" @click="remove(it)"><X class="h-3 w-3" /></button>
    </div>
  </div>
</template>
