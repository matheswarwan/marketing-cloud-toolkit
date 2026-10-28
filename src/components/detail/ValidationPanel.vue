<script setup>
defineProps({
  results:   { type: Object, default: null },
  isRunning: { type: Boolean, default: false },
})
</script>

<template>
  <div class="p-4 text-sm overflow-y-auto h-full flex flex-col gap-2">

    <!-- Loading -->
    <div v-if="isRunning" class="flex items-center justify-center flex-1 text-muted-foreground text-sm">
      Validating with SFMC…
    </div>

    <template v-else-if="results">

      <!-- No activities -->
      <div v-if="results.noActivities"
        class="text-sm leading-relaxed p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300">
        <strong>No Query Activities found.</strong>
        The validator requires at least one existing Query Activity in your BU to work.
        Please create a sample query activity in Automation Studio, or check that you have permission
        to access Query Activities.
      </div>

      <!-- Fatal error -->
      <div v-else-if="results.fatalError"
        class="text-sm leading-relaxed p-3 rounded-md bg-red-50 dark:bg-red-950/40 border-l-4 border-red-500 dark:border-red-700 text-red-700 dark:text-red-400">
        <strong>Validation failed:</strong> {{ results.fatalError }}
      </div>

      <template v-else>
        <!-- Overall result -->
        <div class="flex items-center justify-between py-2 border-b border-border">
          <span class="font-semibold text-foreground text-xs uppercase tracking-wider">Result</span>
          <span v-if="results.queryValid"
            class="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full font-medium">
            ✓ Query is valid
          </span>
          <span v-else
            class="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full font-medium">
            ✗ Query has errors
          </span>
        </div>

        <!-- Errors -->
        <template v-if="results.errors.length">
          <div class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-2 mb-1">Errors</div>
          <div v-for="(e, i) in results.errors" :key="'e'+i"
            class="text-xs leading-relaxed px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/40 border-l-4 border-red-500 dark:border-red-700 text-red-700 dark:text-red-400 whitespace-pre-wrap">
            {{ e.message }}
          </div>
        </template>

        <!-- Warnings -->
        <template v-if="results.warnings.length">
          <div class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-2 mb-1">Warnings</div>
          <div v-for="(w, i) in results.warnings" :key="'w'+i"
            class="text-xs leading-relaxed px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300 whitespace-pre-wrap">
            {{ w.message }}
          </div>
        </template>

        <!-- All clear -->
        <div v-if="!results.errors.length && !results.warnings.length"
          class="flex items-center justify-center flex-1 text-muted-foreground text-sm">
          No errors or warnings.
        </div>
      </template>

    </template>

    <!-- Initial state -->
    <div v-else class="flex items-center justify-center flex-1 text-muted-foreground text-sm">
      Click Validate to check your query with SFMC
    </div>

  </div>
</template>
