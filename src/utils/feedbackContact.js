// The name and email given with the last feedback, offered again next time
// (feedback #65). Kept in chrome.storage.local; the form stays editable.
export const FEEDBACK_CONTACT_KEY = 'toolkit_feedbackContact'

export async function loadFeedbackContact(storage = globalThis.chrome?.storage?.local) {
  if (!storage) return { name: '', email: '' }
  try {
    const r = await storage.get(FEEDBACK_CONTACT_KEY)
    const c = r?.[FEEDBACK_CONTACT_KEY] || {}
    return { name: typeof c.name === 'string' ? c.name : '', email: typeof c.email === 'string' ? c.email : '' }
  } catch {
    return { name: '', email: '' }
  }
}

/** Saves what was sent; clearing both fields forgets them. */
export async function saveFeedbackContact({ name = '', email = '' }, storage = globalThis.chrome?.storage?.local) {
  if (!storage) return
  const value = { name: name.trim(), email: email.trim() }
  try {
    if (!value.name && !value.email) await storage.remove(FEEDBACK_CONTACT_KEY)
    else await storage.set({ [FEEDBACK_CONTACT_KEY]: value })
  } catch { /* not saved; the form still works */ }
}
