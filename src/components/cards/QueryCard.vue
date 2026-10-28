<script setup>
import { computed } from 'vue'
import { Star } from 'lucide-vue-next'

const props = defineProps({
  id:           String,
  queryText:    String,
  timeStamp:    [Date, Number],
  url:          String,
  name:         String,
  isFavourite:  Boolean,
  businessUnit: { type: Object, default: null },
  deleteMode:   { type: Boolean, default: false },
  isSelected:   { type: Boolean, default: false },
  size:         { type: String, default: 'compact' },  // 'compact' | 'large'
  search:       { type: String, default: '' },
})

const emit = defineEmits(['toggle-select', 'toggle-favourite', 'open-preview'])

const humanReadableDate = computed(() =>
  props.timeStamp ? new Date(props.timeStamp).toLocaleString() : 'Unknown date'
)
const displayName = computed(() => props.name ?? humanReadableDate.value)

const containsSearchText = computed(() => {
  const raw = props.search.toLowerCase().trim()
  if (!raw) return true

  const buTerms = [...raw.matchAll(/bu:(\S+)/g)].map(m => m[1])
  const remaining = raw.replace(/bu:\S+/g, '').trim()

  if (buTerms.length > 0) {
    const buName = (props.businessUnit?.name || '').toLowerCase()
    const buId   = String(props.businessUnit?.accountId || '').toLowerCase()
    const matchesBU = buTerms.every(term => buName.includes(term) || buId.includes(term))
    if (!matchesBU) return false
  }

  if (remaining) {
    return (
      props.queryText?.toLowerCase().includes(remaining) ||
      displayName.value?.toLowerCase().includes(remaining) ||
      (props.businessUnit?.name || '').toLowerCase().includes(remaining)
    )
  }

  return true
})

const previewSql = computed(() => {
  if (!props.queryText) return ''
  return props.queryText.split('\n').slice(0, props.size === 'large' ? 40 : 18).join('\n')
})
</script>

<template>
  <div v-if="containsSearchText">
    <div
      class="relative rounded-xl border bg-card shadow-sm overflow-hidden cursor-pointer outline-none transition-all duration-150"
      :style="{ width: size === 'large' ? '460px' : '300px' }"
      :class="{
        'border-primary ring-2 ring-primary/30': deleteMode && isSelected,
        'border-border': !(deleteMode && isSelected),
        'hover:-translate-y-0.5 hover:shadow-lg focus:-translate-y-0.5 focus:shadow-lg': !deleteMode,
      }"
      @click="deleteMode ? emit('toggle-select', props.id) : emit('open-preview', props.id)"
      role="button"
      tabindex="0"
      @keyup.enter="deleteMode ? emit('toggle-select', props.id) : emit('open-preview', props.id)"
      @keyup.space.prevent="deleteMode ? emit('toggle-select', props.id) : emit('open-preview', props.id)"
      :title="deleteMode ? (isSelected ? 'Deselect' : 'Select') : `${displayName} — click to preview`"
    >
      <!-- Selection checkbox overlay (delete mode only) -->
      <div v-if="deleteMode" class="absolute top-2 right-2 z-10">
        <input
          type="checkbox"
          class="h-4 w-4 cursor-pointer accent-primary"
          :checked="isSelected"
          readonly
          @click.stop="emit('toggle-select', props.id)"
        />
      </div>

      <!-- Card header -->
      <div class="px-2.5 py-1.5 border-b border-border bg-muted/40 flex flex-col gap-0.5">
        <div class="flex items-center gap-1 min-w-0">
          <span class="text-[11px] font-semibold text-foreground truncate flex-1 min-w-0">
            {{ displayName }}
          </span>
          <button v-if="!deleteMode"
            class="shrink-0 transition-colors p-0.5 rounded"
            :class="isFavourite ? 'text-amber-400' : 'text-muted-foreground/30 hover:text-amber-400'"
            title="Toggle favourite"
            @click.stop="emit('toggle-favourite', props.id)"
          >
            <Star class="h-3 w-3" :fill="isFavourite ? 'currentColor' : 'none'" />
          </button>
        </div>
        <span v-if="businessUnit?.name"
          class="inline-block self-start text-[9px] font-semibold text-primary bg-primary/10 border border-primary/30 rounded-full px-1.5 py-px truncate max-w-full"
          :title="`BU: ${businessUnit.name} (${businessUnit.accountId})`">
          {{ businessUnit.name }}
        </span>
      </div>

      <!-- SQL preview (dark code area) -->
      <div class="bg-[#0f172a] overflow-hidden p-2.5" :style="{ height: size === 'large' ? '420px' : '210px' }">
        <pre class="sql-preview font-mono leading-relaxed text-slate-300 whitespace-pre overflow-hidden m-0 pointer-events-none" :class="size === 'large' ? 'text-[12px]' : 'text-[11px]'">{{ previewSql }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Fade-to-transparent mask on SQL preview - can't be done with Tailwind */
.sql-preview {
  -webkit-mask-image: linear-gradient(to bottom, black 75%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 75%, transparent 100%);
}
</style>
