<script setup>
import { ref } from 'vue'
import { explainRunError } from '@/utils/runErrors.js'
import { AlertTriangle, Copy, Check, LogIn, RefreshCw } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'

const STEP_LABELS = ['Validate', 'Create DE', 'Create Activity', 'Run', 'Fetch Results']

const props = defineProps({
  stepStatuses:     { type: Array, default: () => Array(5).fill('pending') },
  stepErrors:       { type: Array, default: () => Array(5).fill(null) },
  stepDetails:      { type: Array, default: () => Array(5).fill(null) },
  elapsedSeconds:   { type: Number, default: 0 },
  completedSummary: { type: String, default: null },
  // The SQL that ran, to explain errors that give no reason.
  sql:              { type: String, default: '' },
})

const emit = defineEmits(['retry', 'login', 'prompt'])

const expandedWarnings = ref(null)
const copied = ref(null)

async function copyDetail(text) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => { copied.value = null }, 1500)
  } catch {}
}

function stepClass(idx) {
  const s = props.stepStatuses[idx]
  if (s === 'done')    return 'step--done'
  if (s === 'running') return 'step--running'
  if (s === 'error')   return 'step--error'
  return 'step--pending'
}

function formatElapsed(s) {
  const m   = Math.floor(s / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function detailText(detail) {
  if (!detail) return null
  if (typeof detail === 'string') return detail
  return detail.text ?? null
}

function detailWarnings(detail) {
  if (!detail || typeof detail === 'string') return null
  return detail.warnings?.length ? detail.warnings : null
}

function toggleWarnings(idx) {
  expandedWarnings.value = expandedWarnings.value === idx ? null : idx
}
</script>

<template>
  <div class="px-4 py-3">

    <!-- Completed summary banner -->
    <div v-if="completedSummary"
      class="flex items-center gap-2 px-3.5 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
      <Check class="h-4 w-4 shrink-0" />
      {{ completedSummary }}
    </div>

    <!-- Step track -->
    <div v-else class="flex items-start gap-0 w-full stepper-track">
      <div
        v-for="(label, idx) in STEP_LABELS"
        :key="idx"
        class="flex-1 flex flex-col items-center relative min-w-0"
        :class="stepClass(idx)"
      >
        <!-- Chevron pill -->
        <div class="step-pill flex items-center justify-center gap-1.5 w-full h-8 px-2">
          <Check v-if="stepStatuses[idx] === 'done'" class="h-3 w-3 shrink-0 step-icon" />
          <span v-else-if="stepStatuses[idx] === 'error'" class="text-[11px] font-bold shrink-0 step-icon">✕</span>
          <span v-else-if="stepStatuses[idx] === 'running'" class="step-spinner shrink-0" />
          <span v-else class="text-[10px] font-bold shrink-0 step-num">{{ idx + 1 }}</span>
          <span class="text-[11px] font-semibold truncate step-label">{{ label }}</span>
        </div>

        <!-- Below-pill detail area -->
        <div class="w-full px-1.5 pt-1 flex flex-col items-center gap-0.5" v-if="stepStatuses[idx] !== 'pending'">

          <!-- Elapsed timer -->
          <span v-if="stepStatuses[idx] === 'running'"
            class="text-[10px] text-muted-foreground tabular-nums">
            {{ formatElapsed(elapsedSeconds) }}
          </span>

          <!-- Done: detail text + optional warnings -->
          <template v-if="stepStatuses[idx] === 'done' && detailText(stepDetails[idx])">
            <div class="flex items-center gap-1 flex-wrap justify-center">
              <a v-if="stepDetails[idx]?.href" :href="stepDetails[idx].href" target="_blank"
                class="text-[10px] text-primary underline font-mono word-break-all text-center">
                {{ detailText(stepDetails[idx]) }}
              </a>
              <span v-else class="text-[10px] text-muted-foreground font-mono word-break-all text-center">
                {{ detailText(stepDetails[idx]) }}
              </span>

              <!-- Copy button -->
              <button v-if="stepDetails[idx]?.copyText"
                class="text-[10px] border border-border rounded px-1 bg-card text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                :class="{ 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400': copied === stepDetails[idx].copyText }"
                @click.prevent="copyDetail(stepDetails[idx].copyText)">
                {{ copied === stepDetails[idx].copyText ? '✓' : '⎘' }}
              </button>

              <!-- Warnings toggle -->
              <button v-if="detailWarnings(stepDetails[idx])"
                class="text-[10px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded px-1.5 py-px hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors whitespace-nowrap"
                @click="toggleWarnings(idx)">
                <AlertTriangle class="h-2.5 w-2.5 inline -mt-px" />
                {{ expandedWarnings === idx ? 'Hide' : 'Show' }}
              </button>
            </div>

            <ul v-if="expandedWarnings === idx && detailWarnings(stepDetails[idx])"
              class="w-full list-none p-1.5 mt-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed space-y-0.5">
              <li v-for="(w, wi) in detailWarnings(stepDetails[idx])" :key="wi" class="before:content-['⚠_'] before:text-amber-600">{{ w }}</li>
            </ul>
          </template>

          <!-- Question for the user (e.g. open Contact Builder?) -->
          <div v-if="stepDetails[idx]?.prompt && stepStatuses[idx] === 'running'"
            class="w-full p-1.5 flex flex-col gap-1 items-center bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded text-center">
            <span class="text-[10px] text-amber-800 dark:text-amber-300 leading-snug">{{ stepDetails[idx].prompt.text }}</span>
            <div class="flex gap-1">
              <Button size="sm" class="h-6 text-[10px] bg-primary hover:bg-primary/90 text-white" @click="emit('prompt', true)">
                {{ stepDetails[idx].prompt.confirmLabel || 'Yes' }}
              </Button>
              <Button variant="outline" size="sm" class="h-6 text-[10px]" @click="emit('prompt', false)">
                {{ stepDetails[idx].prompt.cancelLabel || 'No' }}
              </Button>
            </div>
          </div>

          <!-- Error -->
          <div v-if="stepStatuses[idx] === 'error'"
            class="w-full p-1.5 flex flex-col gap-1 items-center bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded text-center">
            <template v-if="stepErrors[idx]?.includes('SESSION_EXPIRED')">
              <span class="text-[10px] text-red-700 dark:text-red-400 leading-snug">Session expired - please log in.</span>
              <Button size="sm" class="h-6 text-[10px] bg-primary hover:bg-primary/90 text-white" @click="emit('login')">
                <LogIn class="h-3 w-3 mr-1" /> Log in to SFMC
              </Button>
            </template>
            <template v-else>
              <span class="text-[10px] text-red-700 dark:text-red-400 leading-snug wrap-break-word">{{ stepErrors[idx] }}</span>
              <div v-if="explainRunError(stepErrors[idx], sql)" class="w-full text-left text-[10px] leading-snug text-foreground bg-card border border-border rounded p-1.5 space-y-0.5">
                <div><b>Likely cause:</b> {{ explainRunError(stepErrors[idx], sql).cause }}</div>
                <div v-if="explainRunError(stepErrors[idx], sql).fix"><b>Fix:</b> {{ explainRunError(stepErrors[idx], sql).fix }}</div>
                <ul v-if="explainRunError(stepErrors[idx], sql).sqlHints.length" class="list-disc pl-4 text-muted-foreground">
                  <li v-for="h in explainRunError(stepErrors[idx], sql).sqlHints" :key="h">{{ h }}</li>
                </ul>
              </div>
              <Button variant="outline" size="sm" class="h-6 text-[10px] border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" @click="emit('retry', idx)">
                <RefreshCw class="h-3 w-3 mr-1" /> Retry
              </Button>
            </template>
          </div>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Chevron pill shapes - cannot be replicated with standard Tailwind alone */
.step-pill {
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  position: relative;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%);
  padding-left: 16px;
  padding-right: 8px;
  transition: background 0.15s;
}
.stepper-track > div:first-child .step-pill {
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%);
  padding-left: 10px;
}
.stepper-track > div:last-child .step-pill {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%);
  padding-right: 10px;
}

/* Status colours */
.step--done    .step-pill { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.step--running .step-pill { background: hsl(var(--primary) / 0.1); border-color: hsl(var(--primary)); }
.step--error   .step-pill { background: hsl(var(--destructive) / 0.1); border-color: hsl(var(--destructive)); }
.step--pending .step-pill { background: hsl(var(--muted)); border-color: hsl(var(--border)); }

/* Icon / label colours per state */
.step--done    .step-icon  { color: white; }
.step--done    .step-label { color: white; }
.step--running .step-label { color: hsl(var(--primary)); }
.step--error   .step-label { color: hsl(var(--destructive)); }
.step--error   .step-icon  { color: hsl(var(--destructive)); }
.step--pending .step-label { color: hsl(var(--muted-foreground)); }
.step--pending .step-num   { color: hsl(var(--muted-foreground)); }

/* Spinner */
.step-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid hsl(var(--primary));
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
