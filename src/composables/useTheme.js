import { ref } from 'vue'

// Kept under SFMC Query Saver's key so an imported backup keeps the user's choice.
const THEME_KEY = 'sfmcqs_theme'

export const THEMES = [
  { id: 'light', label: 'Light', swatch: '#f8fafc' },
  { id: 'dark', label: 'Dark', swatch: '#0f172a' },
  { id: 'system', label: 'System', swatch: 'linear-gradient(135deg, #f8fafc 50%, #0f172a 50%)' },
]

const currentTheme = ref('light')
let media = null

function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

// The app's own Light/Dark choice drives the `.dark` class; "System" follows the OS.
// Component colours always come from these tokens, never from a media query directly
// (SFMC Query Saver Bug 8).
function applyTheme(themeId) {
  const dark = themeId === 'dark' || (themeId === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

function watchSystem() {
  if (media) return
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => { if (currentTheme.value === 'system') applyTheme('system') })
  } catch { /* no matchMedia (tests) */ }
}

export function useTheme() {
  function loadTheme() {
    watchSystem()
    try {
      chrome.storage.local.get(THEME_KEY, (result) => {
        const saved = THEMES.some((t) => t.id === result?.[THEME_KEY]) ? result[THEME_KEY] : 'light'
        currentTheme.value = saved
        applyTheme(saved)
      })
    } catch { applyTheme(currentTheme.value) }
  }

  function setTheme(themeId) {
    currentTheme.value = themeId
    applyTheme(themeId)
    try { chrome.storage.local.set({ [THEME_KEY]: themeId }) } catch { /* not in an extension */ }
  }

  return { currentTheme, themes: THEMES, loadTheme, setTheme }
}
