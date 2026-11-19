<script setup>
// About (feedback #1109): a sidebar entry instead of the bottom of Settings.
import { ref } from 'vue'
import { Sparkles, Shield, MessageSquare, Star, Settings } from 'lucide-vue-next'
import CreatorCredit from '@/components/shell/CreatorCredit.vue'
import FeedbackModal from '@/components/modals/FeedbackModal.vue'
import { policy } from '@/utils/policy.js'
import { STORE_REVIEWS_URL } from '@/utils/storeLinks.js'

const version = (() => {
  try { return chrome.runtime.getManifest().version } catch { return '' }
})()
const showFeedback = ref(false)
const btn = 'h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md border border-border text-sm hover:bg-accent no-underline text-foreground'
</script>

<template>
  <div class="max-w-2xl mx-auto px-5 py-8 text-sm" data-testid="about-page">
    <div class="flex items-center gap-3">
      <img src="/images/icon32x32.png" alt="" class="h-10 w-10 rounded-lg" />
      <div>
        <h1 class="text-lg font-bold">Marketing Cloud Toolkit</h1>
        <p class="text-muted-foreground">Version {{ version }}</p>
      </div>
    </div>
    <p class="mt-4">Queries, data extensions, automations, journeys, content and sending in Salesforce Marketing Cloud, in one tab. It combines SFMC Query Saver and SFMC Automation Viewer.</p>
    <p class="mt-2 text-muted-foreground"><CreatorCredit /></p>
    <div class="flex flex-wrap gap-2 mt-5">
      <RouterLink to="/features" :class="btn"><Sparkles class="h-4 w-4" /> Features and what is new</RouterLink>
      <a href="privacy.html" target="_blank" rel="noopener" :class="btn"><Shield class="h-4 w-4" /> Privacy policy</a>
      <button v-if="!policy.disableFeedback" type="button" :class="btn" @click="showFeedback = true"><MessageSquare class="h-4 w-4" /> Send feedback</button>
      <a :href="STORE_REVIEWS_URL" target="_blank" rel="noopener" :class="btn"><Star class="h-4 w-4" /> Write a review</a>
      <RouterLink to="/settings" :class="btn"><Settings class="h-4 w-4" /> Settings</RouterLink>
    </div>
    <FeedbackModal v-if="showFeedback && !policy.disableFeedback" screen="about" @close="showFeedback = false" />
  </div>
</template>
