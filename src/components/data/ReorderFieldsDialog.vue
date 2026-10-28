<script setup>
// Reorder columns (feedback #1013): drag the fields (or use the arrows) into a new
// order, then save it in place or make a copy of the DE in that order (utils/deReorder.js).
import { computed, onMounted, ref } from 'vue'
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, GripVertical, Loader2, X, RotateCcw } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import { fieldTypeLabel } from '@/utils/deApi.js'
import { readFieldOrder, moveItem, sameOrder, reorderInPlace, copyInNewOrder, copyName } from '@/utils/deReorder.js'

const props = defineProps({
  stack: { type: String, required: true },
  de: { type: Object, required: true },
})
const emit = defineEmits(['close', 'changed'])

const original = ref([])
const order = ref([])
const loadError = ref('')
// 'loading' | 'edit' | 'saving' | 'notApplied' (in place failed) | 'copyForm' | 'copying' | 'done'
const phase = ref('loading')
const result = ref(null)
const failure = ref('')
const step = ref('')
const copyNameText = ref(copyName(props.de.name))
const changed = computed(() => !sameOrder(order.value, original.value))
const busy = computed(() => phase.value === 'saving' || phase.value === 'copying')

onMounted(async () => {
  try {
    original.value = await readFieldOrder(props.stack, props.de.id)
    order.value = original.value.slice()
    phase.value = 'edit'
  } catch (e) {
    loadError.value = e.message
  }
})

const move = (from, to) => { order.value = moveItem(order.value, from, to) }

// Drag and drop: the row being dragged and the row it is over.
const dragFrom = ref(null)
const dragOver = ref(null)
function onDrop(i) {
  if (dragFrom.value != null) move(dragFrom.value, i)
  dragFrom.value = dragOver.value = null
}

async function saveInPlace() {
  phase.value = 'saving'
  failure.value = ''
  try {
    const r = await reorderInPlace(props.stack, props.de, order.value)
    if (r.applied) {
      original.value = r.order
      result.value = { kind: 'inPlace' }
      phase.value = 'done'
      emit('changed')
    } else {
      failure.value = r.error ? `SFMC refused the change: ${r.error}` : 'SFMC accepted the request but kept the old order.'
      phase.value = 'notApplied'
    }
  } catch (e) {
    failure.value = e.message
    phase.value = 'notApplied'
  }
}

async function makeCopy() {
  phase.value = 'copying'
  failure.value = ''
  try {
    const r = await copyInNewOrder(props.stack, props.de, order.value, { name: copyNameText.value.trim(), onStep: (s) => { step.value = s } })
    result.value = { kind: 'copy', ...r }
    phase.value = 'done'
    emit('changed')
  } catch (e) {
    failure.value = e.message
    phase.value = 'notApplied'
  }
}

function close() { if (!busy.value) emit('close') }
</script>

<template>
  <div class="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4" @mousedown.self="close" @keydown.esc="close">
    <div class="w-full max-w-lg max-h-[90vh] flex flex-col rounded-lg border border-border bg-card shadow-xl text-sm" role="dialog" aria-modal="true" aria-labelledby="de-reorder-title">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h2 id="de-reorder-title" class="font-semibold truncate">Reorder columns: {{ de.name }}</h2>
        <button class="ml-auto text-muted-foreground hover:text-foreground disabled:opacity-40" :disabled="busy" title="Close" @click="close"><X class="h-4 w-4" /></button>
      </div>

      <div class="flex-1 overflow-auto px-4 py-3 space-y-3">
        <p v-if="loadError" class="text-red-600">Could not load the fields: {{ loadError }}</p>
        <div v-else-if="phase === 'loading'" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading fields…</div>

        <template v-else-if="phase === 'done'">
          <p v-if="result.kind === 'inPlace'" class="text-emerald-700 dark:text-emerald-400">Saved. SFMC now has the columns in the new order.</p>
          <template v-else>
            <p class="text-emerald-700 dark:text-emerald-400">Created <b>{{ result.de.name }}</b> with the columns in the new order, in the same folder as the original.</p>
            <p v-if="result.rows != null && result.sourceRows != null">
              Rows copied: {{ result.rows.toLocaleString() }} of {{ result.sourceRows.toLocaleString() }}.
              <span v-if="result.rows !== result.sourceRows" class="text-amber-700 dark:text-amber-400">The counts differ: check the copy before using it (rows that broke the copy's rules, or rows added while it ran).</span>
            </p>
            <p v-if="result.sendableDropped" class="text-amber-700 dark:text-amber-400">The original is sendable, but its send relationship could not be read, so the copy is not sendable. Set it in Contact Builder if you need it.</p>
            <p v-if="result.activityLeft" class="text-amber-700 dark:text-amber-400">The query activity that copied the rows could not be deleted. It is in Automation Studio's QuerySaver folder, named TK_Reorder_….</p>
            <p class="text-muted-foreground">The original is unchanged. Data retention is not copied. Anything that uses the original (queries, journeys, imports, sends) still points at it: switch them to the copy, then delete or rename the original yourself.</p>
          </template>
        </template>

        <template v-else>
          <p class="text-muted-foreground">Drag the fields, or use the arrows. Then save the order in place, or make a copy of the data extension in this order.</p>
          <ol class="rounded-md border border-border divide-y divide-border/60">
            <li v-for="(f, i) in order" :key="f.name" draggable="true"
              class="flex items-center gap-2 px-2 py-1 bg-card" :class="{ 'bg-accent': dragOver === i, 'opacity-50': dragFrom === i }"
              @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver === i && (dragOver = null)" @drop.prevent="onDrop(i)" @dragend="dragFrom = dragOver = null">
              <GripVertical class="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
              <span class="w-6 text-right tabular-nums text-muted-foreground">{{ i + 1 }}</span>
              <span class="flex-1 min-w-0 truncate" :class="{ 'font-semibold': f.isPrimaryKey }" :title="f.isPrimaryKey ? 'Primary key' : ''">{{ f.name }}</span>
              <span class="text-xs text-muted-foreground whitespace-nowrap">{{ fieldTypeLabel(f) }}</span>
              <button class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="busy || i === 0" :aria-label="`Move ${f.name} to the top`" title="To the top" @click="move(i, 0)"><ChevronsUp class="h-3.5 w-3.5" /></button>
              <button class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="busy || i === 0" :aria-label="`Move ${f.name} up`" title="Up" @click="move(i, i - 1)"><ArrowUp class="h-3.5 w-3.5" /></button>
              <button class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="busy || i === order.length - 1" :aria-label="`Move ${f.name} down`" title="Down" @click="move(i, i + 1)"><ArrowDown class="h-3.5 w-3.5" /></button>
              <button class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" :disabled="busy || i === order.length - 1" :aria-label="`Move ${f.name} to the bottom`" title="To the bottom" @click="move(i, order.length - 1)"><ChevronsDown class="h-3.5 w-3.5" /></button>
            </li>
          </ol>

          <div v-if="phase === 'notApplied' || phase === 'copyForm'" class="rounded-md border p-3 space-y-2" :class="failure ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800' : 'border-border'">
            <p v-if="failure">{{ failure }}</p>
            <p>You can make a copy of the data extension with the columns in this order. The rows are copied by a query activity; the original is not changed.</p>
            <label class="block">
              <span class="text-xs text-muted-foreground">Name of the copy</span>
              <input v-model="copyNameText" class="mt-0.5 h-8 w-full rounded border border-border bg-background px-2" />
            </label>
          </div>
          <div v-if="phase === 'copying'" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> {{ step }}…</div>
          <div v-if="phase === 'saving'" class="flex items-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Saving the order in SFMC…</div>
        </template>
      </div>

      <div class="flex items-center gap-2 px-4 py-3 border-t border-border">
        <button v-if="phase === 'edit' || phase === 'notApplied' || phase === 'copyForm'" class="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline" :disabled="!changed" @click="order = original.slice()"><RotateCcw class="h-3 w-3" /> Reset</button>
        <div class="flex-1" />
        <template v-if="phase === 'done' || loadError">
          <Button size="sm" class="h-8 text-xs" @click="emit('close')">Close</Button>
        </template>
        <template v-else-if="phase === 'notApplied' || phase === 'copyForm' || phase === 'copying'">
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy" @click="close">Cancel</Button>
          <Button size="sm" class="h-8 text-xs" :disabled="busy || !copyNameText.trim()" @click="makeCopy">Make the copy</Button>
        </template>
        <template v-else-if="phase !== 'loading'">
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy" @click="close">Cancel</Button>
          <Button variant="outline" size="sm" class="h-8 text-xs" :disabled="busy || !changed" title="Leave the original as it is and make a copy in this order" @click="failure = ''; phase = 'copyForm'">Make a copy</Button>
          <Button size="sm" class="h-8 text-xs" :disabled="busy || !changed" title="Change the field order of this data extension in SFMC" @click="saveInPlace">Save order</Button>
        </template>
      </div>
    </div>
  </div>
</template>
