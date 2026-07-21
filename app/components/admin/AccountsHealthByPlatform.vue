<script setup lang="ts">
import type { AccountsHealthByPlatform } from "~~/shared/types/accounts-health"

const props = defineProps<{ byPlatform: AccountsHealthByPlatform }>()

interface PlatformRow {
  platform: "tiktok" | "youtube" | "instagram"
  label: string
  icon: string
  count: number
  percent: number
  barClass: string
}

const rows = computed<PlatformRow[]>(() => {
  const bp = props.byPlatform
  const max = Math.max(bp.tiktok, bp.youtube, bp.instagram, 1)
  return [
    {
      platform: "tiktok",
      label: "TikTok",
      icon: "mingcute:tiktok-line",
      count: bp.tiktok,
      percent: (bp.tiktok / max) * 100,
      barClass: "bg-primary",
    },
    {
      platform: "youtube",
      label: "YouTube",
      icon: "mingcute:youtube-line",
      count: bp.youtube,
      percent: (bp.youtube / max) * 100,
      barClass: "bg-error",
    },
    {
      platform: "instagram",
      label: "Instagram",
      icon: "mingcute:instagram-line",
      count: bp.instagram,
      percent: (bp.instagram / max) * 100,
      barClass: "bg-secondary",
    },
  ]
})
</script>

<template>
  <div class="card bg-base-100 shadow-sm h-full">
    <div class="card-body p-4 gap-3">
      <h3 class="card-title text-sm">
        <Icon name="mingcute:chart-bar-line" />
        По платформам
      </h3>
      <div class="space-y-2">
        <div
          v-for="row in rows"
          :key="row.platform"
          class="flex items-center gap-3"
        >
          <div class="flex items-center gap-2 w-28 shrink-0">
            <Icon :name="row.icon" class="text-lg" />
            <span class="text-sm">{{ row.label }}</span>
          </div>
          <div class="flex-1 h-6 bg-base-200 rounded-box overflow-hidden">
            <div
              class="h-full transition-all"
              :class="row.barClass"
              :style="{ width: row.percent + '%' }"
            />
          </div>
          <div class="w-12 text-right text-sm font-mono">{{ row.count }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
