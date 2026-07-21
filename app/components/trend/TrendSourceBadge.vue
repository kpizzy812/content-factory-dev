<script setup lang="ts">
defineProps<{
  externalId: number | null
}>()
</script>

<template>
  <span v-if="externalId != null" class="badge badge-secondary badge-sm gap-1">
    <Icon name="mingcute:arrow-right-down-line" class="text-xs" />
    MarketingCamp
  </span>
  <span v-else class="badge badge-accent badge-sm gap-1">
    <Icon name="mingcute:home-4-line" class="text-xs" />
    Завод
  </span>
</template>
