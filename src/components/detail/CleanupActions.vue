<script setup>
import { ref } from 'vue'
import Button from '@/components/ui/button/Button.vue'

defineProps({
  deKey:      { type: String, default: null },
  activityId: { type: String, default: null },
  isDeleting: { type: Object, default: () => ({ de: false, activity: false }) },
})

const emit = defineEmits(['delete-de', 'delete-activity'])

const confirmDe       = ref(false)
const confirmActivity = ref(false)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-border bg-muted/30 shrink-0">

    <!-- Delete DE -->
    <template v-if="deKey">
      <template v-if="!confirmDe">
        <Button variant="outline" size="sm" :disabled="isDeleting.de" @click="confirmDe = true"
          class="border-destructive text-destructive hover:bg-destructive/10">
          Delete Data Extension
        </Button>
      </template>
      <template v-else>
        <span class="text-xs text-destructive font-medium">Delete this DE permanently?</span>
        <Button size="sm" :disabled="isDeleting.de" @click="emit('delete-de'); confirmDe = false"
          class="bg-destructive hover:bg-destructive/90 text-white">
          {{ isDeleting.de ? 'Deleting…' : 'Yes, delete' }}
        </Button>
        <Button variant="outline" size="sm" @click="confirmDe = false">Cancel</Button>
      </template>
    </template>

    <!-- Delete Activity -->
    <template v-if="activityId">
      <template v-if="!confirmActivity">
        <Button variant="outline" size="sm" :disabled="isDeleting.activity" @click="confirmActivity = true"
          class="border-destructive text-destructive hover:bg-destructive/10">
          Delete Query Activity
        </Button>
      </template>
      <template v-else>
        <span class="text-xs text-destructive font-medium">Delete this activity permanently?</span>
        <Button size="sm" :disabled="isDeleting.activity" @click="emit('delete-activity'); confirmActivity = false"
          class="bg-destructive hover:bg-destructive/90 text-white">
          {{ isDeleting.activity ? 'Deleting…' : 'Yes, delete' }}
        </Button>
        <Button variant="outline" size="sm" @click="confirmActivity = false">Cancel</Button>
      </template>
    </template>

  </div>
</template>
