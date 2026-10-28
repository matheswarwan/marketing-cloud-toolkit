<script setup>
import { computed } from 'vue'
import { compile } from '@/utils/emailCompiler.js'
import { Star } from 'lucide-vue-next'

const props = defineProps({
  id:                   { type: String, required: true },
  assetId:              { type: Number, default: null },
  name:                 { type: String, default: '' },
  subject:              { type: String, default: '' },
  status:               { type: String, default: '' },
  assetTypeDisplayName: { type: String, default: '' },
  categoryName:         { type: String, default: '' },
  timeStamp:            { type: [Date, Number], default: null },
  ownerName:            { type: String, default: '' },
  compileAsset:         { type: Object, default: null },
  isFavourite:          { type: Boolean, default: false },
  deleteMode:           { type: Boolean, default: false },
  isSelected:           { type: Boolean, default: false },
  versionCount:         { type: Number, default: 1 },
})

const emit = defineEmits(['toggle-select', 'toggle-favourite', 'open'])

const humanReadableDate = computed(() =>
  props.timeStamp ? new Date(props.timeStamp).toLocaleString() : 'Unknown date'
)
const displayName = computed(() => props.name || humanReadableDate.value)

function openDetail() {
  emit('open', props.id)
}

// Compile the asset model into a final HTML string for the preview iframe.
// Falls back to null (shows placeholder) if no compileAsset is stored yet.
const compiledHtml = computed(() => {
  if (!props.compileAsset) return null
  try {
    const html = compile(props.compileAsset, 'html')
    return html || null
  } catch {
    return null
  }
})
</script>

<template>
  <div
    class="relative w-[200px] rounded-xl border bg-card shadow-sm overflow-hidden transition-all duration-150 cursor-pointer"
    :class="{
      'border-primary ring-2 ring-primary/30': deleteMode && isSelected,
      'border-border': !(deleteMode && isSelected),
      'hover:-translate-y-0.5 hover:shadow-lg': !deleteMode,
    }"
    :title="deleteMode ? (isSelected ? 'Deselect' : 'Select') : displayName"
    role="button"
    tabindex="0"
    @click="deleteMode ? emit('toggle-select', props.id) : openDetail()"
    @keyup.enter="deleteMode ? emit('toggle-select', props.id) : openDetail()"
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
        <span class="text-[11px] font-semibold text-foreground truncate flex-1 min-w-0" :title="displayName">
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
      <div class="flex items-center gap-1 flex-wrap">
        <span v-if="categoryName"
          class="inline-flex items-center gap-0.5 text-[9px] font-semibold text-muted-foreground bg-muted border border-border rounded-full px-1.5 py-px truncate max-w-full"
          :title="`Folder: ${categoryName}`">
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
          {{ categoryName }}
        </span>
        <span v-if="status"
          class="inline-block text-[9px] font-semibold rounded-full px-1.5 py-px whitespace-nowrap"
          :class="status === 'Published'
            ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800'
            : 'text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-700'">
          {{ status }}
        </span>
      </div>
    </div>

    <!-- Email preview area -->
    <div class="h-[130px] overflow-hidden relative bg-white">

      <!-- Compiled HTML preview (iframe, scaled down to fit the card) -->
      <div v-if="compiledHtml" class="preview-scaler">
        <iframe
          class="preview-frame"
          sandbox
          :srcdoc="compiledHtml"
          title="Email preview"
        />
      </div>

      <!-- Placeholder: shown for older records without compileAsset, or on compile error -->
      <div v-else
        class="h-full flex flex-col items-center justify-center gap-2 p-3 bg-muted/30">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
          class="text-muted-foreground/40 shrink-0">
          <rect width="20" height="16" x="2" y="4" rx="2"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
        </svg>
        <p v-if="subject"
          class="text-[9px] text-muted-foreground text-center leading-relaxed line-clamp-3 px-1 w-full">
          {{ subject }}
        </p>
        <p v-else class="text-[9px] text-muted-foreground/40 text-center italic">(no subject)</p>
      </div>
    </div>

    <!-- Card footer -->
    <div class="px-2.5 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between gap-1">
      <span class="text-[9px] text-muted-foreground truncate">{{ humanReadableDate }}</span>
      <span class="text-[9px] text-muted-foreground/70 shrink-0">{{ versionCount }} {{ versionCount === 1 ? 'version' : 'versions' }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * Scale a 600px-wide email preview down to fit the 200px card.
 * 200 / 600 = 0.3333
 * The iframe is 600×390 but rendered at 33% → appears as 200×130.
 */
.preview-scaler {
  width: 200px;
  height: 130px;
  overflow: hidden;
  position: absolute;
  inset: 0;
}

.preview-frame {
  width: 600px;
  height: 390px;
  border: none;
  transform: scale(0.3333);
  transform-origin: top left;
  pointer-events: none;
}
</style>
