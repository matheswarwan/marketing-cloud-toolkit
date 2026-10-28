<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Moon } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme.js'
import Button from '@/components/ui/button/Button.vue'

const { currentTheme, themes, setTheme } = useTheme()

const open = ref(false)
const panel = ref(null)

function toggle() { open.value = !open.value }

function pick(themeId) {
  setTheme(themeId)
  open.value = false
}

function onDocClick(e) {
  if (panel.value && !panel.value.contains(e.target)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div ref="panel" class="relative">
    <Button
      variant="ghost"
      size="icon"
      class="h-8 w-8 text-muted-foreground"
      :class="open ? 'bg-accent text-accent-foreground' : ''"
      title="Switch theme"
      @click="toggle"
    >
      <Moon class="h-4 w-4" />
    </Button>

    <div
      v-if="open"
      class="absolute right-0 top-full mt-1 z-9999 w-40 rounded-lg border border-border bg-popover shadow-lg py-1 overflow-hidden"
    >
      <button
        v-for="t in themes"
        :key="t.id"
        class="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors"
        :class="currentTheme === t.id ? 'font-semibold text-primary' : 'text-foreground'"
        @click="pick(t.id)"
      >
        <span
          class="h-3 w-3 rounded-full border border-border shrink-0"
          :style="{ background: t.swatch }"
        />
        {{ t.label }}
        <span v-if="currentTheme === t.id" class="ml-auto text-primary">✓</span>
      </button>
    </div>
  </div>
</template>
