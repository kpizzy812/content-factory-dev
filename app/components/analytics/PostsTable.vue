<script setup lang="ts">
import type { UploadWithMetrics, AnalyticsListMeta } from '#shared/types/analytics'

defineProps<{
  posts: UploadWithMetrics[]
  meta: AnalyticsListMeta
  sortBy: string
  sortOrder: string
}>()

const emit = defineEmits<{
  'update:sort': [field: string]
}>()

const router = useRouter()

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

interface Column {
  key: string
  label: string
  sortable: boolean
}

const columns: Column[] = [
  { key: 'title', label: 'Название', sortable: false },
  { key: 'platform', label: 'Платформа', sortable: false },
  { key: 'account', label: 'Аккаунт', sortable: false },
  { key: 'views', label: 'Просмотры', sortable: true },
  { key: 'watchThrough', label: 'Досмотры%', sortable: true },
  { key: 'likes', label: 'Лайки', sortable: true },
  { key: 'comments', label: 'Комменты', sortable: true },
  { key: 'shares', label: 'Шеры', sortable: true },
  { key: 'ctr', label: 'CTR', sortable: true },
  { key: 'followerGain', label: 'Прирост', sortable: true },
  { key: 'createdAt', label: 'Дата', sortable: true },
]

function handleSort(col: Column) {
  if (col.sortable) {
    emit('update:sort', col.key)
  }
}

function goToDetail(id: number) {
  router.push(`/analytics/${id}`)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}
</script>

<template>
  <div class="overflow-x-auto bg-base-100 rounded-box shadow-sm">
    <table class="table table-sm">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="whitespace-nowrap"
            :class="{ 'cursor-pointer hover:bg-base-200': col.sortable }"
            @click="handleSort(col)"
          >
            <span class="inline-flex items-center gap-1">
              {{ col.label }}
              <template v-if="col.sortable && sortBy === col.key">
                <Icon
                  :name="sortOrder === 'asc' ? 'mingcute:arrow-up-line' : 'mingcute:arrow-down-line'"
                  class="text-primary text-xs"
                />
              </template>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="post in posts"
          :key="post.id"
          class="hover:bg-base-200 cursor-pointer transition-colors"
          @click="goToDetail(post.id)"
        >
          <td class="max-w-48 truncate font-medium">{{ post.title || 'Без названия' }}</td>
          <td>
            <span class="badge badge-sm badge-ghost">
              {{ platformLabels[post.socialAccount?.platform ?? ''] ?? '---' }}
            </span>
          </td>
          <td class="text-sm text-base-content/70">{{ post.socialAccount?.displayName ?? '---' }}</td>
          <td>{{ post.latestMetrics ? formatNumber(post.latestMetrics.views) : '---' }}</td>
          <td>{{ post.latestMetrics ? `${post.latestMetrics.watchThrough}%` : '---' }}</td>
          <td>{{ post.latestMetrics ? formatNumber(post.latestMetrics.likes) : '---' }}</td>
          <td>{{ post.latestMetrics ? formatNumber(post.latestMetrics.comments) : '---' }}</td>
          <td>{{ post.latestMetrics ? formatNumber(post.latestMetrics.shares) : '---' }}</td>
          <td>{{ post.latestMetrics ? `${post.latestMetrics.ctr.toFixed(1)}%` : '---' }}</td>
          <td>{{ post.latestMetrics ? formatNumber(post.latestMetrics.followerGain) : '---' }}</td>
          <td class="text-sm text-base-content/70">{{ formatDate(post.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
