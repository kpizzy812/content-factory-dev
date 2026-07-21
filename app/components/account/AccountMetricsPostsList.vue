<script setup lang="ts">
import type { NormalizedPost } from "~~/shared/types/account-metrics"

// formatNumber — auto-import из app/utils/format.ts

defineProps<{
  posts: NormalizedPost[]
  platform: string | null
}>()

function openPost(url: string): void {
  if (!url) return
  window.open(url, "_blank", "noopener,noreferrer")
}
</script>

<template>
  <div class="space-y-2">
    <h3 class="text-sm font-semibold flex items-center gap-1">
      <Icon name="mingcute:grid-line" class="text-sm" />
      Последние посты выборки
      <span class="text-xs text-base-content/60 font-normal">({{ posts.length }})</span>
    </h3>

    <div
      v-if="posts.length === 0"
      class="text-xs text-base-content/50 italic"
    >
      Посты не найдены в текущем снимке
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-2">
      <div
        v-for="post in posts"
        :key="post.id"
        role="link"
        tabindex="0"
        :aria-label="`Открыть пост: ${post.title ?? 'без названия'}`"
        class="card card-border card-sm bg-base-100 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
        @click="openPost(post.url)"
        @keydown.enter="openPost(post.url)"
        @keydown.space.prevent="openPost(post.url)"
      >
        <figure class="aspect-[9/16] bg-base-200 relative overflow-hidden">
          <img
            v-if="post.thumbnailUrl"
            :src="post.thumbnailUrl"
            :alt="post.title ?? 'post thumbnail'"
            class="w-full h-full object-cover"
            referrerpolicy="no-referrer"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          >
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-base-content/30"
          >
            <Icon name="mingcute:image-line" class="text-3xl" />
          </div>
        </figure>
        <div class="card-body p-2 gap-1">
          <p class="text-xs line-clamp-2" :title="post.title ?? ''">
            {{ post.title ?? "Без названия" }}
          </p>
          <div class="flex items-center gap-2 text-xs text-base-content/60">
            <span class="flex items-center gap-0.5">
              <Icon name="mingcute:eye-line" class="text-xs" />
              {{ formatNumber(post.viewCount) }}
            </span>
            <span class="flex items-center gap-0.5">
              <Icon name="mingcute:heart-line" class="text-xs" />
              {{ formatNumber(post.likeCount) }}
            </span>
            <span class="flex items-center gap-0.5">
              <Icon name="mingcute:message-3-line" class="text-xs" />
              {{ formatNumber(post.commentCount) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
