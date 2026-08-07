<script setup lang="ts">
/**
 * Таблица публикаций с метриками.
 *
 * Сортировка настоящая — `/api/analytics/posts` принимает `sortBy`/`sortOrder`,
 * поэтому стрелки в шапке рисуются: кликабельный заголовок, который ничего не
 * меняет, хуже отсутствующего.
 *
 * Клик по строке открывает разбор публикации на этом же экране, стрелка в
 * последней колонке уводит на историю замеров.
 */
import { formatRate } from './AnalyticsFormat'
import type { UploadWithMetrics } from '#shared/types/analytics'

const props = defineProps<{
  posts: UploadWithMetrics[]
  sortBy: string
  sortOrder: string
}>()

const emit = defineEmits<{
  'update:sort': [field: string]
  select: [uploadId: number]
}>()

const COLUMNS = '180px 110px 150px repeat(7, minmax(64px, 1fr)) 96px 36px'

const sort = computed(() => `${props.sortOrder === 'desc' ? '-' : ''}${props.sortBy}`)

/** `UiTableHeadCell` отдаёт '-views', стор хранит поле и направление отдельно. */
function onSort(value: string) {
  emit('update:sort', value.replace(/^-/, ''))
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
</script>

<template>
  <UiTable :columns="COLUMNS" min-width="1180px">
    <UiTableHead>
      <span>Название</span>
      <span>Площадка</span>
      <span>Аккаунт</span>
      <UiTableHeadCell sort-key="views" :sort="sort" align="right" @sort="onSort">Просмотры</UiTableHeadCell>
      <UiTableHeadCell sort-key="watchThrough" :sort="sort" align="right" @sort="onSort">Досмотр</UiTableHeadCell>
      <UiTableHeadCell sort-key="likes" :sort="sort" align="right" @sort="onSort">Лайки</UiTableHeadCell>
      <UiTableHeadCell sort-key="comments" :sort="sort" align="right" @sort="onSort">Комм.</UiTableHeadCell>
      <UiTableHeadCell sort-key="shares" :sort="sort" align="right" @sort="onSort">Репосты</UiTableHeadCell>
      <UiTableHeadCell sort-key="ctr" :sort="sort" align="right" @sort="onSort">CTR</UiTableHeadCell>
      <UiTableHeadCell sort-key="followerGain" :sort="sort" align="right" @sort="onSort">Прирост</UiTableHeadCell>
      <UiTableHeadCell sort-key="createdAt" :sort="sort" align="right" @sort="onSort">Дата</UiTableHeadCell>
      <span />
    </UiTableHead>

    <UiTableRow
      v-for="post in posts"
      :key="post.id"
      class="cursor-pointer"
      @click="emit('select', post.id)"
    >
      <span class="truncate" :title="post.title">{{ post.title || 'Без названия' }}</span>
      <span>
        <UiPlatformBadge v-if="post.socialAccount" :platform="post.socialAccount.platform" />
        <span v-else class="text-subtle">—</span>
      </span>
      <span class="truncate font-mono text-sm text-muted">
        {{ post.socialAccount?.displayName ?? '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm">
        {{ post.latestMetrics ? formatNumber(post.latestMetrics.views) : '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm">{{ formatRate(post.latestMetrics?.watchThrough) }}</span>
      <span class="tnum text-right font-mono text-sm">
        {{ post.latestMetrics ? formatNumber(post.latestMetrics.likes) : '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm">
        {{ post.latestMetrics ? formatNumber(post.latestMetrics.comments) : '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm">
        {{ post.latestMetrics ? formatNumber(post.latestMetrics.shares) : '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm">{{ formatRate(post.latestMetrics?.ctr) }}</span>
      <span class="tnum text-right font-mono text-sm">
        {{ post.latestMetrics ? formatNumber(post.latestMetrics.followerGain) : '—' }}
      </span>
      <span class="tnum text-right font-mono text-sm text-muted">{{ formatDate(post.createdAt) }}</span>
      <NuxtLink
        :to="`/analytics/${post.id}`"
        class="flex justify-end text-muted hover:text-fg"
        :aria-label="`История замеров публикации ${post.id}`"
        @click.stop
      >
        <Icon name="mingcute:right-line" />
      </NuxtLink>
    </UiTableRow>
  </UiTable>
</template>
