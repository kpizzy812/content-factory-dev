<script setup lang="ts">
import type { NormalizedPost } from '~~/shared/types/account-metrics'

/**
 * Посты из выборки последнего снимка. `formatNumber` — авто-импорт из `app/utils/format.ts`.
 * `mingcute:image-line` в наборе нет, заглушка кадра рисуется `mingcute:pic-line`.
 */
defineProps<{
  posts: NormalizedPost[]
  platform: string | null
}>()

function openPost(url: string): void {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <h3 class="flex items-center gap-1.5 text-sm font-medium">
      <Icon name="mingcute:grid-line" />
      Посты выборки
      <span class="tnum font-mono text-micro font-normal text-subtle">{{ posts.length }}</span>
    </h3>

    <p v-if="!posts.length" class="text-micro text-subtle">
      В текущем снимке постов нет.
    </p>

    <div v-else class="grid grid-cols-2 gap-2 md:grid-cols-3">
      <div
        v-for="post in posts"
        :key="post.id"
        role="link"
        tabindex="0"
        :aria-label="`Открыть пост: ${post.title ?? 'без названия'}`"
        class="cursor-pointer overflow-hidden rounded-md border border-border bg-card transition-colors duration-(--duration-fast) hover:border-accent"
        @click="openPost(post.url)"
        @keydown.enter="openPost(post.url)"
        @keydown.space.prevent="openPost(post.url)"
      >
        <div class="relative aspect-[9/16] overflow-hidden bg-neutral-bg">
          <img
            v-if="post.thumbnailUrl"
            :src="post.thumbnailUrl"
            :alt="post.title ?? 'кадр поста'"
            class="size-full object-cover"
            referrerpolicy="no-referrer"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          >
          <div v-else class="flex size-full items-center justify-center text-subtle">
            <Icon name="mingcute:pic-line" class="text-2xl" />
          </div>
        </div>
        <div class="flex flex-col gap-1 p-2">
          <p class="line-clamp-2 text-micro" :title="post.title ?? ''">
            {{ post.title ?? 'Без названия' }}
          </p>
          <div class="flex items-center gap-2 text-micro text-subtle">
            <span class="tnum flex items-center gap-0.5">
              <Icon name="mingcute:eye-line" />
              {{ formatNumber(post.viewCount) }}
            </span>
            <span class="tnum flex items-center gap-0.5">
              <Icon name="mingcute:heart-line" />
              {{ formatNumber(post.likeCount) }}
            </span>
            <span class="tnum flex items-center gap-0.5">
              <Icon name="mingcute:message-3-line" />
              {{ formatNumber(post.commentCount) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
