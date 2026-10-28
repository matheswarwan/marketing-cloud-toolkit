import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// For a section page: when it is opened with ?q=… (from Ctrl+K), call `run(q)` and
// remove q from the URL. Works for kept-alive pages too (the watcher sees later
// visits).
export function useRouteSearch(path, run) {
  const route = useRoute()
  const router = useRouter()
  const apply = () => {
    if (route.path !== path || typeof route.query.q !== 'string') return
    const q = route.query.q
    router.replace({ path })
    run(q)
  }
  apply()
  watch(() => route.query.q, apply)
}
