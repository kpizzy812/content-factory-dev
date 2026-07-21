<script setup lang="ts">
const props = withDefaults(defineProps<{
  count?: number
  variant?: 'card' | 'row'
  cols?: 1 | 2 | 3
}>(), {
  count: 6,
  variant: 'card',
  cols: 3,
})

const colsClass = computed(() => {
  switch (props.cols) {
    case 1: return 'grid-cols-1'
    case 2: return 'grid-cols-1 sm:grid-cols-2'
    case 3: return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
  }
})
</script>

<template>
  <div v-if="variant === 'card'" class="grid gap-4" :class="colsClass">
    <div
      v-for="i in count"
      :key="i"
      class="card bg-base-100 card-border p-4 space-y-3"
    >
      <div class="flex items-center gap-3">
        <div class="skeleton h-10 w-10 rounded-full shrink-0" />
        <div class="flex-1 space-y-2">
          <div class="skeleton h-4 w-3/4" />
          <div class="skeleton h-3 w-1/2" />
        </div>
      </div>
      <div class="skeleton h-3 w-full" />
      <div class="skeleton h-3 w-5/6" />
      <div class="flex gap-2 pt-1">
        <div class="skeleton h-6 w-16" />
        <div class="skeleton h-6 w-20" />
      </div>
    </div>
  </div>

  <div v-else class="space-y-2">
    <div
      v-for="i in count"
      :key="i"
      class="flex items-center gap-3 p-3 rounded-lg bg-base-100"
    >
      <div class="skeleton h-8 w-8 rounded-full shrink-0" />
      <div class="flex-1 space-y-2">
        <div class="skeleton h-3 w-1/2" />
        <div class="skeleton h-3 w-1/3" />
      </div>
      <div class="skeleton h-6 w-16 shrink-0" />
    </div>
  </div>
</template>
