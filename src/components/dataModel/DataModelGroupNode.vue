<script setup>
// The attribute group a data model map starts from (links to Contacts in Data Designer).
import { Handle, Position } from '@vue-flow/core'
import { Users } from 'lucide-vue-next'

defineProps({ data: { type: Object, required: true } })
defineOptions({ inheritAttrs: false })
</script>

<template>
  <div class="dm-group" :style="{ width: `${data.w}px`, height: `${data.h}px` }" :data-dm-group-node="data.id">
    <Users class="h-5 w-5 shrink-0" aria-hidden="true" />
    <span class="min-w-0">
      <span class="dm-group-name" :title="data.group.name">{{ data.group.name }}</span>
      <span class="dm-group-sub">Attribute group · Contacts</span>
    </span>
    <Handle type="source" :position="Position.Right" :connectable="false" class="dm-handle" />
  </div>
</template>
