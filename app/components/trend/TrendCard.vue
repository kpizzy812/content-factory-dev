<script setup lang="ts">
const props = defineProps<{
  trend: {
    id: number
    platform: string
    title: string
    authorName?: string | null
    thumbnailUrl?: string | null
    viewCount: number
    likeCount: number
    commentCount: number
    status: string
    analysisStatus?: string
    importedAt: string
    externalId?: number | null
  }
}>()

const emit = defineEmits<{
  deleted: [id: number]
}>()

const { canDelete } = usePermissions()

const deleting = ref(false)
const confirmDelete = ref(false)
const thumbFailed = ref(false)

function goToDetail() {
  if (confirmDelete.value) return
  navigateTo(`/trends/${props.trend.id}`)
}

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }

  deleting.value = true
  try {
    await $fetch(`/api/trends/${props.trend.id}`, { method: 'DELETE' })
    emit('deleted', props.trend.id)
  } catch {
    // error handled silently, card stays
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}

function cancelDelete() {
  confirmDelete.value = false
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const analysisLabel = computed(() => {
  const s = props.trend.analysisStatus
  if (s === 'completed') return 'AI'
  if (s === 'running') return '...'
  if (s === 'failed') return '!'
  return null
})

const analysisClass = computed(() => {
  const s = props.trend.analysisStatus
  if (s === 'completed') return 'badge-success'
  if (s === 'running') return 'badge-warning'
  if (s === 'failed') return 'badge-error'
  return ''
})
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="goToDetail"
  >
    <div class="card-body p-4 gap-2">
      <div class="flex items-start gap-3">
        <!-- Миниатюра (с fallback при истёкшей TikTok CDN-подписи) -->
        <div
          v-if="trend.thumbnailUrl && !thumbFailed"
          class="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-base-200"
        >
          <img
            :src="trend.thumbnailUrl"
            :alt="trend.title"
            class="w-full h-full object-cover"
            referrerpolicy="no-referrer"
            @error="thumbFailed = true"
          >
        </div>
        <div
          v-else
          class="shrink-0 w-20 h-20 rounded-lg bg-base-200 flex items-center justify-center"
        >
          <Icon name="mingcute:video-line" class="text-2xl text-base-content/30" />
        </div>

        <!-- Контент -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <TrendPlatformBadge :platform="trend.platform" />
            <TrendStatusBadge :status="trend.status" />
            <TrendSourceBadge :external-id="trend.externalId ?? null" />
            <span
              v-if="analysisLabel"
              class="badge badge-xs"
              :class="analysisClass"
            >
              {{ analysisLabel }}
            </span>
          </div>

          <h3 class="font-semibold text-base-content line-clamp-2 text-sm">
            {{ trend.title }}
          </h3>

          <p v-if="trend.authorName" class="text-xs text-base-content/50 mt-0.5">
            {{ trend.authorName }}
          </p>
        </div>

        <!-- Кнопка удаления -->
        <div v-if="canDelete" class="shrink-0" @click.stop>
          <template v-if="confirmDelete">
            <div class="flex gap-1">
              <button
                class="btn btn-xs btn-error"
                :disabled="deleting"
                @click="handleDelete"
              >
                <span v-if="deleting" class="loading loading-spinner loading-xs" />
                <template v-else>Да</template>
              </button>
              <button
                class="btn btn-xs btn-ghost"
                :disabled="deleting"
                @click="cancelDelete"
              >
                Нет
              </button>
            </div>
          </template>
          <button
            v-else
            class="btn btn-xs btn-ghost text-base-content/30 hover:text-error"
            title="Удалить тренд"
            @click="handleDelete"
          >
            <Icon name="mingcute:delete-2-line" />
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between mt-1">
        <TrendMetrics
          :view-count="trend.viewCount"
          :like-count="trend.likeCount"
          :comment-count="trend.commentCount"
        />
        <span class="text-xs text-base-content/40">
          {{ formatDate(trend.importedAt) }}
        </span>
      </div>
    </div>
  </div>
</template>
