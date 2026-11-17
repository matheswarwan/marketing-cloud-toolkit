<script setup>
// Data model overview, as Data Designer opens: the attribute groups on a circle around
// Contacts, each with its number of attributes and attribute sets. Click a group to open
// its map. Layout in utils/dataModelMap.js (overviewLayout).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Users, Database, Smartphone, Mail, ShoppingCart, MessageSquare, Route as RouteIcon, BellRing } from 'lucide-vue-next'
import { overviewLayout } from '@/utils/dataModelMap.js'

const props = defineProps({ groups: { type: Array, required: true } })
const emit = defineEmits(['open'])

const BUBBLE = 116
const layout = computed(() => overviewLayout(props.groups, { bubble: BUBBLE }))
const c = computed(() => layout.value.size / 2)
// Scaled down to fit its box, as Data Designer fits its circle (never scaled up).
const box = ref(null)
const room = ref({ w: 0, h: 0 })
let observer = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !box.value) return
  observer = new ResizeObserver(() => { room.value = { w: box.value.clientWidth - 16, h: box.value.clientHeight - 16 } })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())
const scale = computed(() => (room.value.w > 0 && room.value.h > 0 ? Math.min(1, room.value.w / layout.value.size, room.value.h / layout.value.size) : 1))

// An icon from the group's name or what its sets are stored in (Data Designer has its own).
function iconFor(g) {
  const n = g.name.toLowerCase()
  const kinds = g.sets.map((s) => s.storage.toLowerCase()).join(' ')
  if (/push/.test(n) || /push/.test(kinds)) return BellRing
  if (/mobile|sms|line|groupconnect/.test(n) || /mobile/.test(kinds)) return Smartphone
  if (/email/.test(n)) return Mail
  if (/chat|whatsapp/.test(n)) return MessageSquare
  if (/predictive|product|order|transaction|purchase/.test(n)) return ShoppingCart
  if (/journey/.test(n)) return RouteIcon
  if (/system/.test(n)) return Users
  return Database
}
const label = (g) => `${g.name}: ${g.attributeCount} attributes in ${g.sets.length} attribute ${g.sets.length === 1 ? 'set' : 'sets'}. Open its map.`
</script>

<template>
  <div ref="box" class="dm-overview overflow-hidden" data-dm-overview>
    <div class="mx-auto" :style="{ width: `${layout.size * scale}px`, height: `${layout.size * scale}px` }">
    <div class="relative origin-top-left" :style="{ width: `${layout.size}px`, height: `${layout.size}px`, transform: `scale(${scale})` }">
      <svg class="absolute inset-0" :width="layout.size" :height="layout.size" aria-hidden="true">
        <circle :cx="c" :cy="c" :r="Math.max(c - 20, 0)" class="dm-ring" />
        <line v-for="it in layout.items" :key="it.group.id" :x1="c" :y1="c" :x2="it.x" :y2="it.y" class="dm-spoke" />
      </svg>
      <div class="dm-hub" :style="{ left: `${c}px`, top: `${c}px` }">
        <Users class="h-10 w-10" aria-hidden="true" />
        <span>Contacts</span>
      </div>
      <button v-for="it in layout.items" :key="it.group.id" type="button" class="dm-bubble" :data-dm-group="it.group.id"
        :style="{ left: `${it.x}px`, top: `${it.y}px`, width: `${BUBBLE}px`, height: `${BUBBLE}px` }"
        :title="it.group.name" :aria-label="label(it.group)" @click="emit('open', it.group.id)">
        <span class="dm-cap"><component :is="iconFor(it.group)" class="h-4 w-4" aria-hidden="true" /><span class="dm-cap-name">{{ it.group.name }}</span></span>
        <span class="dm-count">{{ it.group.attributeCount.toLocaleString() }}</span>
        <span class="dm-unit">Attributes</span>
        <span class="dm-sets">{{ it.group.sets.length }} {{ it.group.sets.length === 1 ? 'set' : 'sets' }}</span>
      </button>
    </div>
    </div>
  </div>
</template>

<style scoped>
.dm-ring { fill: hsl(var(--primary) / 0.06); stroke: none; }
.dm-spoke { stroke: hsl(var(--border)); stroke-width: 2; }
.dm-hub {
  position: absolute; width: 150px; height: 150px; transform: translate(-50%, -50%); border-radius: 9999px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  background: hsl(var(--card)); border: 3px solid hsl(var(--border)); color: hsl(var(--muted-foreground)); font-size: 18px;
}
.dm-hub span { color: hsl(var(--foreground)); }
.dm-bubble {
  position: absolute; transform: translate(-50%, -50%); border-radius: 9999px; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; background: hsl(var(--card));
  border: 3px solid hsl(var(--border)); box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); transition: transform .12s, border-color .12s;
}
.dm-bubble:hover, .dm-bubble:focus-visible { transform: translate(-50%, -50%) scale(1.06); border-color: hsl(var(--primary)); outline: none; }
.dm-cap {
  width: 100%; height: 46px; padding: 6px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
}
.dm-cap-name { max-width: 88px; font-size: 11px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-count { margin-top: 4px; font-size: 24px; line-height: 1; font-weight: 600; color: hsl(var(--foreground)); }
.dm-unit { font-size: 11px; color: hsl(var(--muted-foreground)); }
.dm-sets { font-size: 10px; color: hsl(var(--muted-foreground)); }
</style>
