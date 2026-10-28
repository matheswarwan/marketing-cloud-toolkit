<script setup>
// A small ? next to a control: click for what it does (feedback #150, as in Data Cloud
// Inspector). `topics` is a help table ({ id: { title, text } }).
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { CircleHelp } from 'lucide-vue-next'

const props = defineProps({
  topic: { type: String, required: true },
  topics: { type: Object, required: true },
})
const emit = defineEmits(['more'])
const help = computed(() => props.topics[props.topic])
const open = ref(false)
const btn = ref(null)
const pop = ref(null)
const pos = ref({ top: 0, left: 0 })

function toggle() {
  if (open.value) { open.value = false; return }
  const r = btn.value.getBoundingClientRect()
  const top = r.bottom + 6 + 180 > window.innerHeight ? Math.max(8, r.top - 186) : r.bottom + 6
  pos.value = { top, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 336)) }
  open.value = true
  nextTick(() => pop.value?.focus())
}
const onDoc = (e) => { if (pop.value && !pop.value.contains(e.target) && !btn.value?.contains(e.target)) open.value = false }
const onKey = (e) => { if (e.key === 'Escape') open.value = false }
watch(open, (v) => {
  const m = v ? 'addEventListener' : 'removeEventListener'
  document[m]('pointerdown', onDoc, true)
  document[m]('keydown', onKey)
})
onBeforeUnmount(() => { open.value = false })
</script>

<template>
  <button v-if="help" ref="btn" type="button" class="inline-flex align-middle p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent" :aria-label="`What is ${help.title}?`" :title="`What is ${help.title}?`" :aria-expanded="open" @click.stop="toggle"><CircleHelp class="w-3.5 h-3.5" /></button>
  <Teleport to="body">
    <div v-if="open && help" ref="pop" tabindex="-1" role="dialog" :aria-label="help.title" class="fixed z-[200] w-80 border border-border rounded-md bg-card text-foreground shadow-lg p-3 text-sm font-normal normal-case tracking-normal space-y-1.5 focus:outline-none" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
      <div class="font-medium">{{ help.title }}</div>
      <p class="text-muted-foreground leading-snug text-xs">{{ help.text }}</p>
      <button class="text-xs text-primary hover:underline" @click="open = false; emit('more')">All Query Builder help</button>
    </div>
  </Teleport>
</template>
