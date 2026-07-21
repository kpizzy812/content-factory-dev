<script setup lang="ts">
defineProps<{
  platform: string
}>()

const platformMap: Record<string, { label: string; icon: string }> = {
  tiktok: { label: 'TikTok', icon: 'mingcute:tiktok-fill' },
  instagram: { label: 'Instagram', icon: 'mingcute:instagram-fill' },
  youtube: { label: 'YouTube', icon: 'mingcute:youtube-fill' },
}
</script>

<template>
  <span class="badge badge-outline badge-sm gap-1">
    <Icon
      :name="platformMap[platform]?.icon ?? 'mingcute:globe-line'"
      class="text-sm"
    />
    {{ platformMap[platform]?.label ?? platform }}
  </span>
</template>
