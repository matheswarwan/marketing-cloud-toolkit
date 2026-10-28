<script setup>
// Stacked columns per day (runs succeeded / failed). Marks follow the dataviz rules:
// columns at most 24px, 4px rounded top, a 2px gap between segments, hairline
// grid, text in text colours, a legend, a hover tooltip per column and a table view.
import { computed, ref } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true }, // [{ key, ...values }]
  series: { type: Array, required: true }, // [{ key, label, color }] bottom to top
  title: { type: String, default: '' },
  labelOf: { type: Function, default: (r) => r.key },
  selected: { type: Number, default: -1 }, // the clicked column, highlighted
})
// A click on a column (or its row in the table) emits its index.
const emit = defineEmits(['select'])

const W = 720
const H = 200
const PAD = { l: 36, r: 8, t: 8, b: 22 }
const plotW = W - PAD.l - PAD.r
const plotH = H - PAD.t - PAD.b
const total = (r) => props.series.reduce((s, x) => s + (r[x.key] || 0), 0)
const max = computed(() => Math.max(1, ...props.rows.map(total)))
const ticks = computed(() => {
  const raw = max.value / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const top = Math.ceil(max.value / step) * step
  return { top, values: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
})
const band = computed(() => plotW / Math.max(1, props.rows.length))
const barW = computed(() => Math.min(24, Math.max(2, band.value * 0.6)))
const y = (v) => PAD.t + plotH - (v / ticks.value.top) * plotH
const GAP = 2

// Segments of one column, bottom up; only the top one gets the rounded end.
function segments(r, i) {
  const x = PAD.l + i * band.value + (band.value - barW.value) / 2
  const out = []
  let base = 0
  const present = props.series.filter((s) => r[s.key] > 0)
  present.forEach((s, j) => {
    const v = r[s.key]
    const y0 = y(base)
    const y1 = y(base + v)
    const isTop = j === present.length - 1
    const h = Math.max(0, y0 - y1 - (j ? GAP : 0))
    out.push({ key: s.key, color: s.color, d: path(x, y0 - (j ? GAP : 0) - h, barW.value, h, isTop ? Math.min(4, h, barW.value / 2) : 0) })
    base += v
  })
  return out
}
function path(x, top, w, h, r) {
  if (h <= 0) return ''
  if (!r) return `M${x},${top}h${w}v${h}h${-w}z`
  return `M${x},${top + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`
}
const labelEvery = computed(() => Math.ceil(props.rows.length / 8))

const hover = ref(null) // { i, x, y }
function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const px = ((e.clientX - rect.left) / rect.width) * W
  const i = Math.floor((px - PAD.l) / band.value)
  hover.value = i >= 0 && i < props.rows.length ? { i, left: ((PAD.l + (i + 0.5) * band.value) / W) * 100 } : null
}
const showTable = ref(false)
</script>

<template>
  <figure class="text-xs">
    <figcaption class="flex flex-wrap items-center gap-3 mb-2">
      <span v-if="title" class="font-semibold text-sm">{{ title }}</span>
      <span v-for="s in series" :key="s.key" class="inline-flex items-center gap-1.5 text-muted-foreground">
        <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ background: s.color }" aria-hidden="true" /> {{ s.label }}
      </span>
      <button class="ml-auto text-primary hover:underline" @click="showTable = !showTable">{{ showTable ? 'Show chart' : 'Show table' }}</button>
    </figcaption>
    <div v-if="!showTable" class="relative">
      <!-- Capped so wide windows do not make it tall (feedback #62). -->
      <svg :viewBox="`0 0 ${W} ${H}`" class="w-full h-auto max-w-3xl max-h-56 cursor-pointer" role="img" :aria-label="title" @mousemove="onMove" @mouseleave="hover = null" @click="hover && emit('select', hover.i)">
        <g>
          <template v-for="t in ticks.values" :key="t">
            <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="hsl(var(--border))" stroke-width="1" />
            <text :x="PAD.l - 6" :y="y(t) + 3" text-anchor="end" class="fill-muted-foreground" font-size="10">{{ t >= 1000 ? `${t / 1000}K` : t }}</text>
          </template>
        </g>
        <rect v-if="selected >= 0 && selected < rows.length" :x="PAD.l + selected * band" :y="PAD.t" :width="band" :height="plotH" fill="hsl(var(--primary))" opacity="0.12" />
        <rect v-if="hover" :x="PAD.l + hover.i * band" :y="PAD.t" :width="band" :height="plotH" fill="hsl(var(--muted))" opacity="0.6" />
        <g v-for="(r, i) in rows" :key="r.key">
          <path v-for="sg in segments(r, i)" :key="sg.key" :d="sg.d" :fill="sg.color" />
          <text v-if="i % labelEvery === 0" :x="PAD.l + (i + 0.5) * band" :y="H - 6" text-anchor="middle" class="fill-muted-foreground" font-size="10">{{ labelOf(r) }}</text>
        </g>
      </svg>
      <div v-if="hover" class="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 shadow" :style="{ left: `${hover.left}%` }">
        <div class="font-semibold">{{ labelOf(rows[hover.i]) }}</div>
        <div v-for="s in [...series].reverse()" :key="s.key" class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 rounded-sm" :style="{ background: s.color }" /> {{ s.label }}: <span class="tabular-nums">{{ rows[hover.i][s.key] || 0 }}</span>
        </div>
      </div>
    </div>
    <table v-else class="w-full">
      <thead><tr class="text-left text-muted-foreground border-b border-border"><th class="py-1">Day</th><th v-for="s in series" :key="s.key" class="py-1 text-right">{{ s.label }}</th></tr></thead>
      <tbody><tr v-for="(r, i) in rows" :key="r.key" class="border-b border-border/50 cursor-pointer hover:bg-muted/40" :class="i === selected ? 'bg-primary/10' : ''" @click="emit('select', i)"><td class="py-1">{{ labelOf(r) }}</td><td v-for="s in series" :key="s.key" class="py-1 text-right tabular-nums">{{ r[s.key] || 0 }}</td></tr></tbody>
    </table>
  </figure>
</template>
