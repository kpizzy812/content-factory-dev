<script setup lang="ts">
import type { WarmupKeywordPoolDto } from "~~/shared/types/warmup"

const props = defineProps<{
  pool: WarmupKeywordPoolDto
}>()

const emit = defineEmits<{
  edit: [pool: WarmupKeywordPoolDto]
  delete: [pool: WarmupKeywordPoolDto]
}>()

const platformLabel: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
}

const langBadge = computed(() => {
  if (!props.pool.language) return "badge-ghost"
  if (props.pool.language === "ru") return "badge-info"
  if (props.pool.language === "en") return "badge-primary"
  return "badge-neutral"
})

const langLabel = computed(() => props.pool.language ?? "univ")
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm card-border"
    :class="{ 'opacity-60': !pool.isActive }"
  >
    <div class="card-body p-4 gap-2">
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="min-w-0">
          <h3 class="font-bold text-base truncate">{{ pool.name }}</h3>
          <p class="text-xs text-base-content/50">
            {{ pool.appId ? `App #${pool.appId}` : "Глобальный" }}
          </p>
        </div>
        <div class="flex gap-1 flex-wrap">
          <span class="badge badge-sm" :class="langBadge">{{ langLabel }}</span>
          <span class="badge badge-sm badge-outline">{{ pool.category }}</span>
          <span
            v-if="pool.platform"
            class="badge badge-sm badge-secondary badge-outline"
          >
            {{ platformLabel[pool.platform] ?? pool.platform }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2 text-sm text-base-content/70 flex-wrap">
        <span>
          <Icon name="mingcute:hashtag-line" class="text-xs" />
          {{ pool.keywords.length }} ключей
        </span>
        <span v-if="pool.hashtags.length > 0">
          <Icon name="mingcute:tag-line" class="text-xs" />
          {{ pool.hashtags.length }} хэштегов
        </span>
        <span v-if="!pool.isActive" class="badge badge-sm badge-ghost">
          Отключён
        </span>
      </div>

      <div class="flex flex-wrap gap-1 mt-1">
        <span
          v-for="kw in pool.keywords.slice(0, 8)"
          :key="kw"
          class="badge badge-xs badge-neutral"
        >
          {{ kw }}
        </span>
        <span
          v-if="pool.keywords.length > 8"
          class="badge badge-xs badge-ghost"
        >
          +{{ pool.keywords.length - 8 }}
        </span>
      </div>

      <div class="card-actions justify-end mt-1">
        <button class="btn btn-xs btn-ghost gap-1" @click="emit('edit', pool)">
          <Icon name="mingcute:edit-line" class="text-sm" />
          Редактировать
        </button>
        <button
          class="btn btn-xs btn-error btn-outline gap-1"
          @click="emit('delete', pool)"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
