<script setup>
import { computed } from 'vue'
import { X, Plus } from 'lucide-vue-next'
import Button from '../ui/button/Button.vue'

const props = defineProps({
  // [{ alias, field, label }]
  fieldOptions: { type: Array, default: () => [] },
  modelValue: {
    type: Object,
    default: () => ({ distinct: false, top: null, groupBy: [], orderBy: [], computedColumns: [] }),
  },
})
const emit = defineEmits(['update:modelValue'])

const AGG_TEMPLATES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT(DISTINCT )']

const opts = computed(() => ({
  distinct: !!props.modelValue?.distinct,
  top: props.modelValue?.top ?? null,
  groupBy: Array.isArray(props.modelValue?.groupBy) ? props.modelValue.groupBy : [],
  orderBy: Array.isArray(props.modelValue?.orderBy) ? props.modelValue.orderBy : [],
  computedColumns: Array.isArray(props.modelValue?.computedColumns) ? props.modelValue.computedColumns : [],
}))

function patch(part) {
  emit('update:modelValue', {
    // Keeps having, columnOrder and anything else this form does not show.
    ...(props.modelValue || {}),
    distinct: opts.value.distinct,
    top: opts.value.top,
    groupBy: opts.value.groupBy.map((g) => ({ ...g })),
    orderBy: opts.value.orderBy.map((o) => ({ ...o })),
    computedColumns: opts.value.computedColumns.map((c) => ({ ...c })),
    ...part,
  })
}

function setDistinct(v) { patch({ distinct: v }) }
function setTop(v) {
  const n = parseInt(v, 10)
  patch({ top: Number.isFinite(n) && n > 0 ? n : null })
}

// ── GROUP BY ──
function addGroupBy() {
  const first = props.fieldOptions[0]
  patch({ groupBy: [...opts.value.groupBy, { alias: first?.alias || '', field: first?.field || '' }] })
}
function updateGroupBy(index, encoded) {
  const [alias, field] = encoded.split('::')
  patch({ groupBy: opts.value.groupBy.map((g, i) => (i === index ? { alias, field } : g)) })
}
function addGroupByExpr() { patch({ groupBy: [...opts.value.groupBy, { expr: '' }] }) }
function addOrderByExpr() { patch({ orderBy: [...opts.value.orderBy, { expr: '', dir: 'ASC' }] }) }
function updateItem(list, index, key, value) {
  patch({ [list]: opts.value[list].map((g, i) => (i === index ? { ...g, [key]: value } : g)) })
}
function setHaving(v) { patch({ having: v }) }
function removeGroupBy(index) {
  patch({ groupBy: opts.value.groupBy.filter((_, i) => i !== index) })
}

// ── ORDER BY ──
function addOrderBy() {
  const first = props.fieldOptions[0]
  patch({ orderBy: [...opts.value.orderBy, { alias: first?.alias || '', field: first?.field || '', dir: 'ASC' }] })
}
function updateOrderByField(index, encoded) {
  const [alias, field] = encoded.split('::')
  patch({ orderBy: opts.value.orderBy.map((o, i) => (i === index ? { ...o, alias, field } : o)) })
}
function updateOrderByDir(index, dir) {
  patch({ orderBy: opts.value.orderBy.map((o, i) => (i === index ? { ...o, dir } : o)) })
}
function removeOrderBy(index) {
  patch({ orderBy: opts.value.orderBy.filter((_, i) => i !== index) })
}

// ── Computed / aggregate columns ──
function addComputed(template) {
  let prefill = ''
  if (template === 'COUNT(DISTINCT )') prefill = 'COUNT(DISTINCT )'
  else if (template) prefill = `${template}()`
  patch({ computedColumns: [...opts.value.computedColumns, { id: `c${Date.now().toString(36)}`, expression: prefill, alias: '' }] })
}
function updateComputed(index, key, value) {
  patch({ computedColumns: opts.value.computedColumns.map((c, i) => (i === index ? { ...c, [key]: value } : c)) })
}
function removeComputed(index) {
  patch({ computedColumns: opts.value.computedColumns.filter((_, i) => i !== index) })
}
</script>

<template>
  <div class="space-y-3 text-xs">
    <!-- DISTINCT / TOP -->
    <div class="flex items-center gap-4">
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" class="h-3.5 w-3.5" :checked="opts.distinct" @change="setDistinct($event.target.checked)" />
        <span class="text-[11px]">SELECT DISTINCT</span>
      </label>
      <label class="flex items-center gap-1.5">
        <span class="text-[11px] text-muted-foreground">TOP</span>
        <input
          type="number" min="1" placeholder="—"
          class="w-16 text-[10px] border rounded px-1 py-0.5 bg-background"
          :value="opts.top ?? ''"
          @input="setTop($event.target.value)"
        />
      </label>
    </div>

    <!-- GROUP BY -->
    <div class="space-y-1">
      <div class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Group by</div>
      <div v-for="(g, i) in opts.groupBy" :key="'g' + i" class="flex items-center gap-1">
        <input
          v-if="g.expr !== undefined"
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="g.expr" placeholder="YEAR(t1.[OrderDate])"
          @input="updateItem('groupBy', i, 'expr', $event.target.value)"
        />
        <select
          v-else
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="`${g.alias}::${g.field}`"
          @change="updateGroupBy(i, $event.target.value)"
        >
          <option v-for="opt in fieldOptions" :key="opt.label" :value="`${opt.alias}::${opt.field}`">{{ opt.label }}</option>
        </select>
        <Button variant="ghost" size="icon" class="h-5 w-5 shrink-0" title="Remove group by" @click="removeGroupBy(i)"><X class="h-2.5 w-2.5" /></Button>
      </div>
      <button class="flex items-center gap-0.5 text-[10px] text-primary hover:underline" :disabled="!fieldOptions.length" @click="addGroupBy">
        <Plus class="h-2.5 w-2.5" /> Add group by
      </button>
      <button class="flex items-center gap-0.5 text-[10px] text-primary hover:underline" @click="addGroupByExpr">
        <Plus class="h-2.5 w-2.5" /> Expression
      </button>
      <div v-if="opts.groupBy.length || modelValue?.having" class="flex items-center gap-1 pt-1">
        <span class="text-[10px] font-semibold text-muted-foreground shrink-0">HAVING</span>
        <input
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="modelValue?.having || ''" placeholder="COUNT(*) > 1"
          @input="setHaving($event.target.value)"
        />
      </div>
      <p v-if="opts.groupBy.length" class="text-[9px] text-amber-600">
        With GROUP BY, only grouped columns + computed columns are selected.
      </p>
    </div>

    <!-- ORDER BY -->
    <div class="space-y-1">
      <div class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Order by</div>
      <div v-for="(o, i) in opts.orderBy" :key="'o' + i" class="flex items-center gap-1">
        <input
          v-if="o.expr !== undefined"
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="o.expr" placeholder="[OutputName] or an expression"
          @input="updateItem('orderBy', i, 'expr', $event.target.value)"
        />
        <select
          v-else
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="`${o.alias}::${o.field}`"
          @change="updateOrderByField(i, $event.target.value)"
        >
          <option v-for="opt in fieldOptions" :key="opt.label" :value="`${opt.alias}::${opt.field}`">{{ opt.label }}</option>
        </select>
        <select
          class="text-[10px] border rounded px-0.5 py-0.5 bg-background"
          :value="o.dir || 'ASC'"
          @change="updateOrderByDir(i, $event.target.value)"
        >
          <option value="ASC">ASC</option>
          <option value="DESC">DESC</option>
        </select>
        <Button variant="ghost" size="icon" class="h-5 w-5 shrink-0" title="Remove order by" @click="removeOrderBy(i)"><X class="h-2.5 w-2.5" /></Button>
      </div>
      <button class="flex items-center gap-0.5 text-[10px] text-primary hover:underline" :disabled="!fieldOptions.length" @click="addOrderBy">
        <Plus class="h-2.5 w-2.5" /> Add order by
      </button>
      <button class="flex items-center gap-0.5 text-[10px] text-primary hover:underline" @click="addOrderByExpr">
        <Plus class="h-2.5 w-2.5" /> Expression
      </button>
    </div>

    <!-- Computed / aggregate columns -->
    <div class="space-y-1">
      <div class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Computed / aggregate columns</div>
      <div v-for="(c, i) in opts.computedColumns" :key="'c' + i" class="flex items-center gap-1">
        <input
          class="flex-2 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="c.expression"
          placeholder="COUNT(t1.[SubscriberKey])"
          @input="updateComputed(i, 'expression', $event.target.value)"
        />
        <span class="text-[9px] text-muted-foreground">AS</span>
        <input
          class="flex-1 min-w-0 text-[10px] font-mono border rounded px-1 py-0.5 bg-background"
          :value="c.alias"
          placeholder="alias"
          @input="updateComputed(i, 'alias', $event.target.value)"
        />
        <Button variant="ghost" size="icon" class="h-5 w-5 shrink-0" title="Remove computed column" @click="removeComputed(i)"><X class="h-2.5 w-2.5" /></Button>
      </div>
      <div class="flex items-center flex-wrap gap-1">
        <button class="flex items-center gap-0.5 text-[10px] text-primary hover:underline" @click="addComputed('')">
          <Plus class="h-2.5 w-2.5" /> Custom
        </button>
        <button
          v-for="t in AGG_TEMPLATES" :key="t"
          class="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
          @click="addComputed(t)"
        >{{ t }}</button>
      </div>
      <p class="text-[9px] text-muted-foreground leading-snug">
        Reference columns with their alias, e.g. <code>SUM(t2.[Amount])</code>. Add an alias for a clean header.
      </p>
    </div>
  </div>
</template>
