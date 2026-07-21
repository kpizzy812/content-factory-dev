<script setup lang="ts">
defineProps<{
  videosToday: number
  videosWeek: number
}>()
</script>

<template>
  <div class="stats stats-vertical sm:stats-horizontal shadow-sm w-full">
    <div class="stat">
      <div class="stat-figure text-primary">
        <Icon name="mingcute:video-line" class="text-3xl" />
      </div>
      <div class="stat-title">Роликов за день</div>
      <div class="stat-value text-primary">{{ videosToday }}</div>
    </div>
    <div class="stat">
      <div class="stat-figure text-info">
        <Icon name="mingcute:calendar-line" class="text-3xl" />
      </div>
      <div class="stat-title">Роликов за неделю</div>
      <div class="stat-value text-info">{{ videosWeek }}</div>
    </div>
  </div>
</template>
