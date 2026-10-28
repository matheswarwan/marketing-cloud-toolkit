import { ref } from 'vue'

// One toast at a time, shown by ToastHost in the app shell.
const toast = ref(null) // { message, id }
let timer = null

export function showToast(message, ms = 3500) {
  clearTimeout(timer)
  toast.value = { message, id: Date.now() }
  timer = setTimeout(() => { toast.value = null }, ms)
}

export function useToast() {
  return { toast, showToast }
}
