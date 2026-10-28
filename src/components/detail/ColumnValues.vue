<script setup>
// One column's values (feedback #1012, "like Tableau"): each distinct value with how
// many rows have it, tick values to keep only those rows, or keep only rows whose
// value repeats. Counts cover the rows given (the loaded rows, after the other
// columns' filters); `sfmc` adds buttons that ask SFMC about the whole DE.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { X, Copy } from 'lucide-vue-next'
import { columnValueCounts } from '@/utils/columnValues.js'
import { showToast } from '@/composables/useToast.js'

const SHOWN = 500

const props = defineProps({
  col: { type: String, required: true },
  rows: { type: Array, default: () => [] },
  picked: { type: Array, default: () => [] },
  dups: { type: Boolean, default: false },
  // More rows exist than are loaded.
  partial: { type: Boolean, default: false },
  // Offer "Distinct values in SFMC" / "Duplicates in SFMC" (a data extension's rows).
  sfmc: { type: Boolean, default: false },
})
const emit = defineEmits(['update:picked', 'update:dups', 'close', 'query'])

const stats = computed(() => columnValueCounts(props.rows, props.col))
const search = ref('')
const matching = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? stats.value.values.filter((v) => v.key.toLowerCase().includes(q)) : stats.value.values
})
const shown = computed(() => matching.value.slice(0, SHOWN))
const top = computed(() => stats.value.values[0]?.count || 1)
const pickedSet = computed(() => new Set(props.picked))
const label = (k) => (k === '' ? '(blank)' : k)

function toggle(key) {
  const next = new Set(props.picked)
  next.has(key) ? next.delete(key) : next.add(key)
  emit('update:picked', [...next])
}
const pickShown = () => emit('update:picked', [...new Set([...props.picked, ...matching.value.map((v) => v.key)])])

async function copyValues() {
  const text = ['Value\tRows', ...matching.value.map((v) => `${v.key}\t${v.count}`)].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied ${matching.value.length.toLocaleString()} value(s) with their counts.`)
  } catch (e) {
    showToast(`Could not copy: ${e.message}`)
  }
}

const box = ref(null)
// Opens to the left when the column is too near the right edge of the table.
const alignRight = ref(false)
function place() {
  const el = box.value
  if (!el?.getBoundingClientRect) return
  const edge = el.parentElement?.closest('.overflow-auto, .overflow-hidden')?.getBoundingClientRect().right ?? window.innerWidth
  if (el.getBoundingClientRect().right > edge - 4) alignRight.value = true
}
const onDown = (e) => { if (box.value && !box.value.contains(e.target) && !e.target.closest?.('[data-values-toggle]')) emit('close') }
const onKey = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => { place(); document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) })
</script>

<template>
  <div ref="box" role="dialog" :aria-label="`Values of ${col}`" :class="alignRight ? 'right-0' : 'left-0'"
    class="absolute top-full mt-1 z-30 w-80 max-w-[90vw] rounded-md border border-border bg-popover text-popover-foreground shadow-lg text-xs font-normal text-left whitespace-normal">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
      <span class="font-semibold truncate">{{ col }}</span>
      <button class="ml-auto text-muted-foreground hover:text-foreground" title="Close (Esc)" @click="emit('close')"><X class="h-3.5 w-3.5" /></button>
    </div>
    <div class="px-3 py-2 space-y-1.5 border-b border-border">
      <p data-testid="values-summary">
        <b>{{ stats.distinct.toLocaleString() }}</b> distinct {{ stats.distinct === 1 ? 'value' : 'values' }} in {{ stats.rows.toLocaleString() }} rows<template v-if="stats.blanks">, {{ stats.blanks.toLocaleString() }} blank</template>.
        <template v-if="stats.repeated">{{ stats.repeated.toLocaleString() }} {{ stats.repeated === 1 ? 'value repeats' : 'values repeat' }}.</template>
        <template v-else-if="stats.rows">No value repeats.</template>
      </p>
      <p v-if="partial" class="text-muted-foreground">Counts cover the rows loaded so far. Load all to count every row<template v-if="sfmc">, or ask SFMC:</template><template v-else>.</template></p>
      <div v-if="sfmc" class="flex flex-wrap gap-1.5">
        <button class="px-2 py-0.5 rounded border border-border hover:bg-accent" title="Opens Run Query with a GROUP BY over the whole data extension" @click="emit('query', 'distinct')">Distinct values in SFMC</button>
        <button class="px-2 py-0.5 rounded border border-border hover:bg-accent" title="Opens Run Query with GROUP BY ... HAVING COUNT(*) > 1 over the whole data extension" @click="emit('query', 'duplicates')">Duplicates in SFMC</button>
      </div>
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" :checked="dups" @change="emit('update:dups', $event.target.checked)" />
        Duplicates only: rows whose {{ col }} is on more than one row
      </label>
    </div>
    <div class="px-3 pt-2">
      <input v-model="search" type="search" placeholder="Search values" :aria-label="`Search values of ${col}`"
        class="h-7 w-full rounded border border-border bg-background px-2" />
    </div>
    <ul class="max-h-64 overflow-auto px-1 py-1" data-testid="values-list">
      <li v-for="v in shown" :key="v.key">
        <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer">
          <input type="checkbox" :checked="pickedSet.has(v.key)" @change="toggle(v.key)" />
          <span class="relative flex-1 min-w-0">
            <span class="absolute inset-y-0 left-0 rounded-sm bg-primary/10" :style="{ width: `${(v.count / top) * 100}%` }" />
            <span class="relative block truncate px-1" :class="v.key === '' ? 'italic text-muted-foreground' : ''" :title="label(v.key)">{{ label(v.key) }}</span>
          </span>
          <span class="tabular-nums text-muted-foreground" :class="v.count > 1 && v.key !== '' ? 'font-semibold text-foreground' : ''">{{ v.count.toLocaleString() }}</span>
        </label>
      </li>
      <li v-if="!matching.length" class="px-2 py-2 text-muted-foreground">No value matches.</li>
      <li v-else-if="matching.length > SHOWN" class="px-2 py-1 text-muted-foreground">{{ (matching.length - SHOWN).toLocaleString() }} more: search to find them.</li>
    </ul>
    <div class="flex items-center gap-2 px-3 py-2 border-t border-border">
      <button class="text-primary hover:underline" @click="pickShown">{{ search ? 'Tick matching' : 'Tick all' }}</button>
      <button class="text-primary hover:underline disabled:opacity-40 disabled:no-underline" :disabled="!picked.length" @click="emit('update:picked', [])">Clear{{ picked.length ? ` (${picked.length})` : '' }}</button>
      <button class="ml-auto inline-flex items-center gap-1 text-primary hover:underline" title="Copy the values and their counts, to paste into Excel or Sheets" @click="copyValues"><Copy class="h-3 w-3" /> Copy</button>
    </div>
  </div>
</template>
