<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body items-center text-center py-16">
      <Icon :name="icon" class="text-6xl text-base-content/30 mb-4" />
      <h3 class="text-lg font-semibold text-base-content">
        {{ title }}
      </h3>
      <p class="text-base-content/60 mt-1">
        {{ description }}
      </p>
    </div>
  </div>
</template>
