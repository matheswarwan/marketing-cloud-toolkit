<script setup>
// One attribute set on the data model map, as a Data Designer card: the name with its
// badges, then its fields (key icon, name, type), up to MAX_FIELDS with "+N more".
// Click to open its details; the whole card is one button.
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KeyRound } from 'lucide-vue-next'
import { cardFields, fieldTypeText } from '@/utils/dataModelMap.js'

const props = defineProps({ data: { type: Object, required: true } })
defineOptions({ inheritAttrs: false })
const emit = defineEmits(['select', 'hover'])

const set = computed(() => props.data.set)
const fields = computed(() => cardFields(set.value))
const visible = computed(() => set.value.fields.filter((f) => !f.hidden).length)
const badges = computed(() => [set.value.root && 'Root', set.value.sendable && 'Sendable', set.value.shared && 'Shared'].filter(Boolean))
</script>

<template>
  <div class="dm-card" :class="{ 'is-selected': data.selected, 'is-dim': data.dim, 'is-match': data.match }" :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    @mouseenter="emit('hover', data.id)" @mouseleave="emit('hover', null)">
    <Handle type="target" :position="Position.Left" :connectable="false" class="dm-handle" />
    <button type="button" class="dm-card-button" :data-dm-set="data.id" :aria-pressed="!!data.selected"
      :aria-label="`${set.name}, ${visible} attributes. Show details.`" @click="emit('select', data.id)"
      @focus="emit('hover', data.id)" @blur="emit('hover', null)">
      <span class="dm-card-head">
        <span class="dm-card-name" :title="set.name">{{ set.name }}</span>
        <span class="dm-card-sub">
          <span v-for="b in badges" :key="b" class="dm-badge">{{ b }}</span>
          <span class="truncate">{{ set.storage || 'Attribute set' }} · {{ visible }} {{ visible === 1 ? 'attribute' : 'attributes' }}</span>
        </span>
      </span>
      <span class="dm-card-fields">
        <span v-for="f in fields.shown" :key="f.id || f.name" class="dm-field" :class="{ 'is-pk': f.pk }">
          <KeyRound v-if="f.pk" class="h-3 w-3 shrink-0 dm-key" aria-label="Primary key" />
          <span v-else class="w-3 shrink-0" />
          <span class="dm-field-name" :title="f.name">{{ f.name }}</span>
          <span class="dm-field-type">{{ fieldTypeText(f) }}</span>
        </span>
        <span v-if="fields.more" class="dm-field dm-more">+{{ fields.more }} more</span>
        <span v-if="!fields.shown.length" class="dm-field dm-more">No attributes</span>
      </span>
    </button>
    <Handle type="source" :position="Position.Right" :connectable="false" class="dm-handle" />
  </div>
</template>
