<script setup lang="ts">
/**
 * Карточка пула ключевых слов прогрева.
 *
 * Удаление — разрушающее и уходит в меню; правка частая и остаётся в строке.
 */
import type { WarmupKeywordPoolDto } from '~~/shared/types/warmup'
import { platformMeta } from '~/components/ui/platform-meta'

const props = defineProps<{ pool: WarmupKeywordPoolDto }>()

const emit = defineEmits<{
  edit: [pool: WarmupKeywordPoolDto]
  delete: [pool: WarmupKeywordPoolDto]
}>()

const PREVIEW = 8

const platform = computed(() => props.pool.platform ? platformMeta(props.pool.platform) : null)

const langLabel = computed(() => props.pool.language ?? 'без языка')

const menuItems = [
  { key: 'delete', label: 'Удалить пул', icon: 'mingcute:delete-2-line', danger: true },
]
</script>

<template>
  <article
    class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3"
    :class="!pool.isActive && 'opacity-70'"
  >
    <div class="flex items-start gap-2">
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">{{ pool.name }}</span>
        <span class="block truncate text-sm text-subtle">
          {{ pool.appId ? `приложение #${pool.appId}` : 'общий для всех приложений' }}
        </span>
      </span>
      <UiActionMenu :items="menuItems" @select="emit('delete', pool)" />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 text-micro text-muted">
        {{ langLabel }}
      </span>
      <span class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 text-micro text-muted">
        {{ pool.category }}
      </span>
      <span
        v-if="platform"
        class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
      >
        <span class="size-1.5 rounded-full" :style="{ background: platform.color }" />
        {{ platform.label }}
      </span>
      <span
        v-if="!pool.isActive"
        class="inline-flex h-[18px] items-center rounded-sm border border-divider px-1.5 text-micro text-subtle"
      >
        выключен
      </span>
    </div>

    <div class="tnum flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm text-muted">
      <span>{{ pool.keywords.length }} ключей</span>
      <span v-if="pool.hashtags.length">{{ pool.hashtags.length }} хэштегов</span>
    </div>

    <div v-if="pool.keywords.length" class="flex flex-wrap gap-1">
      <span
        v-for="kw in pool.keywords.slice(0, PREVIEW)"
        :key="kw"
        class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
      >{{ kw }}</span>
      <span
        v-if="pool.keywords.length > PREVIEW"
        class="tnum inline-flex h-[18px] items-center px-1 font-mono text-micro text-subtle"
      >ещё {{ pool.keywords.length - PREVIEW }}</span>
    </div>

    <div class="mt-auto flex justify-end pt-1">
      <UiButton variant="ghost" @click="emit('edit', pool)">
        <Icon name="mingcute:edit-line" />
        Редактировать
      </UiButton>
    </div>
  </article>
</template>
