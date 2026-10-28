import { ref, onMounted, onUnmounted, watch } from 'vue'

/**
 * Polls the service worker for the extension's real SFMC connection status:
 *   • detected stack, • whether a fresh CSRF token is cached,
 *   • which SFMC areas currently have an open, logged-in tab.
 *
 * @param {import('vue').Ref<string|null>} [stackRef] optional stack the page already knows
 */
export function useConnectionStatus(stackRef) {
  const status = ref({
    stack: null,
    connected: false,
    tokenReady: false,
    mcaTokenReady: false,
    areas: { core: { open: false }, contentBuilder: { open: false } },
  })
  const loading = ref(true)
  let timer = null

  function refresh() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'GET_CONNECTION_STATUS', stackKey: stackRef?.value || null },
          (res) => {
            loading.value = false
            if (chrome.runtime.lastError || !res) { resolve(status.value); return }
            status.value = res
            resolve(res)
          }
        )
      } catch {
        loading.value = false
        resolve(status.value)
      }
    })
  }

  onMounted(() => {
    refresh()
    timer = setInterval(refresh, 20000)
  })
  onUnmounted(() => clearInterval(timer))

  // The very first refresh() can fire before the page's own stack detection has
  // resolved (stackRef still null), producing a stale "not connected" snapshot that
  // would otherwise sit there for up to 20s. Re-poll immediately once it changes.
  if (stackRef) watch(stackRef, (val) => { if (val) refresh() })

  return { status, loading, refresh }
}
