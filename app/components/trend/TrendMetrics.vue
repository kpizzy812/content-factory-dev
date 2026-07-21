<script setup lang="ts">
defineProps<{
  viewCount: number
  likeCount: number
  commentCount: number
}>()
</script>

<template>
  <div class="flex items-center gap-3 text-sm text-base-content/70">
    <span class="flex items-center gap-1" :title="`${viewCount} просмотров`">
      <Icon name="mingcute:eye-line" />
      {{ formatNumber(viewCount) }}
    </span>
    <span class="flex items-center gap-1" :title="`${likeCount} лайков`">
      <Icon name="mingcute:heart-line" />
      {{ formatNumber(likeCount) }}
    </span>
    <span class="flex items-center gap-1" :title="`${commentCount} комментариев`">
      <Icon name="mingcute:comment-line" />
      {{ formatNumber(commentCount) }}
    </span>
  </div>
</template>
