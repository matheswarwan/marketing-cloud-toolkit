<script setup>
import { ref } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose } from 'radix-vue'
import { Save, X } from 'lucide-vue-next'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'

const emit = defineEmits(['save', 'validation-error', 'close'])

const sqlName    = ref('')
const enteredSQL = ref('')

async function sendDataToBackground(data) {
  return new Promise((resolve) => {
    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SAVE_RECORDS', records: data }, (response) => {
        if (chrome.runtime.lastError) resolve(false)
        else resolve(response)
      })
    } else {
      resolve(false)
    }
  })
}

// Esc or a click outside closes the dialog, unless something was typed (feedback #1005).
function onOpenChange(open) {
  if (!open && !sqlName.value.trim() && !enteredSQL.value.trim()) emit('close')
}

async function saveSQL() {
  if (!sqlName.value.trim() || !enteredSQL.value.trim()) {
    emit('validation-error')
    return
  }

  const key = 'sql_' + Date.now()
  const now  = Date.now()
  const data = {
    [key]: {
      id: key,
      name: sqlName.value.trim(),
      queryText: enteredSQL.value.trim(),
      timeStamp: now,
      isFavourite: false,
      url: 'https://localhost/',
    },
  }

  const response = await sendDataToBackground(data)
  emit('save', response)
  sqlName.value    = ''
  enteredSQL.value = ''
}
</script>

<template>
  <DialogRoot :open="true" @update:open="onOpenChange">
    <DialogPortal>
      <!-- Overlay -->
      <DialogOverlay class="fixed inset-0 z-9998 bg-black/50" />

      <!-- Modal container -->
      <DialogContent
        class="fixed left-1/2 top-1/2 z-9999 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,760px)] max-h-[80vh] rounded-xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden focus:outline-none"
        @click.stop
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 bg-muted/30 border-b border-border shrink-0">
          <DialogTitle class="text-[15px] font-bold text-foreground">Add SQL Query</DialogTitle>
          <div class="flex items-center gap-2">
            <Button size="sm" class="gap-1.5" @click="saveSQL">
              <Save class="h-3.5 w-3.5" />
              Save
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:bg-red-50 hover:text-red-600"
              title="Cancel" @click="emit('close')">
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <!-- Body -->
        <div class="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider" for="sql-name">
              Query Name
            </label>
            <Input
              id="sql-name"
              v-model="sqlName"
              placeholder="e.g. Active Subscribers Last 90 Days"
              @keyup.esc="emit('close')"
            />
          </div>

          <div class="flex flex-col gap-1.5 flex-1">
            <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider" for="sql-body">
              SQL
            </label>
            <textarea
              id="sql-body"
              v-model="enteredSQL"
              class="flex-1 min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-vertical"
              placeholder="SELECT … FROM … WHERE …"
              rows="14"
              spellcheck="false"
              @keyup.esc="emit('close')"
            />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
