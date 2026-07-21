<script setup lang="ts">
const props = defineProps<{
  scenarioId?: number
  videoId?: number
  uploadId?: number
}>()

const emit = defineEmits<{
  submitted: []
}>()

const feedbackText = ref('')
const isSubmitting = ref(false)
const successMessage = ref(false)
const errorMessage = ref('')

// --- Query params for fetching past feedback ---
const queryParams = computed(() => {
  if (props.scenarioId) return { scenarioId: props.scenarioId }
  if (props.videoId) return { videoId: props.videoId }
  if (props.uploadId) return { uploadId: props.uploadId }
  return {}
})

const {
  data: feedbackList,
  refresh: refreshFeedback,
} = useFetch('/api/scenarios/feedback', {
  query: queryParams,
  default: () => [] as FeedbackEntry[],
})

// --- Submit ---
async function handleSubmit() {
  const text = feedbackText.value.trim()
  if (!text) return

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    await $fetch('/api/scenarios/feedback', {
      method: 'POST',
      body: {
        feedbackText: text,
        scenarioId: props.scenarioId,
        videoId: props.videoId,
        uploadId: props.uploadId,
      },
    })

    feedbackText.value = ''
    successMessage.value = true
    emit('submitted')
    refreshFeedback()

    setTimeout(() => {
      successMessage.value = false
    }, 2000)
  }
  catch (err: any) {
    errorMessage.value = err?.data?.error || err?.message || 'Не удалось отправить отзыв'
  }
  finally {
    isSubmitting.value = false
  }
}

// --- Helpers ---
const sentimentConfig: Record<string, { label: string; class: string }> = {
  positive: { label: 'Позитивный', class: 'badge-success' },
  negative: { label: 'Негативный', class: 'badge-error' },
  neutral: { label: 'Нейтральный', class: 'badge-ghost' },
  mixed: { label: 'Смешанный', class: 'badge-warning' },
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// --- Types ---
interface FeedbackDerived {
  sentiment?: string
  requirements?: string[]
  recommendations?: string[]
  antiPatterns?: string[]
}

interface FeedbackEntry {
  id: number
  feedbackText: string
  createdAt: string
  derived?: FeedbackDerived | null
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-4">
      <!-- Header -->
      <h3 class="card-title text-sm">
        <Icon name="mingcute:comment-line" class="text-base" />
        Обратная связь
      </h3>

      <!-- Form -->
      <form @submit.prevent="handleSubmit" class="space-y-3">
        <textarea
          v-model="feedbackText"
          class="textarea w-full"
          rows="3"
          placeholder="Напишите ваш отзыв или замечания..."
          :disabled="isSubmitting"
        />

        <!-- Error alert -->
        <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft text-sm">
          <Icon name="mingcute:warning-line" class="text-base" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- Submit button -->
        <button
          v-if="!successMessage"
          type="submit"
          class="btn btn-primary btn-sm"
          :disabled="isSubmitting || !feedbackText.trim()"
        >
          <span v-if="isSubmitting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:send-line" class="text-sm" />
          Отправить отзыв
        </button>
        <span v-else class="btn btn-success btn-sm btn-disabled">
          <Icon name="mingcute:check-circle-line" class="text-sm" />
          Отзыв сохранён
        </span>
      </form>

      <!-- Past feedback list -->
      <template v-if="(feedbackList as FeedbackEntry[])?.length">
        <div class="divider text-xs text-base-content/40 my-0">
          История отзывов
        </div>

        <div class="space-y-3 max-h-80 overflow-y-auto">
          <div
            v-for="entry in (feedbackList as FeedbackEntry[])"
            :key="entry.id"
            class="rounded-lg bg-base-200/50 p-3 space-y-2"
          >
            <!-- Feedback header -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-base-content/50">
                {{ formatDate(entry.createdAt) }}
              </span>
              <span
                v-if="entry.derived?.sentiment"
                class="badge badge-xs"
                :class="sentimentConfig[entry.derived.sentiment]?.class || 'badge-ghost'"
              >
                {{ sentimentConfig[entry.derived.sentiment]?.label || entry.derived.sentiment }}
              </span>
            </div>

            <!-- Feedback text -->
            <p class="text-sm text-base-content/80 whitespace-pre-line">
              {{ entry.feedbackText }}
            </p>

            <!-- Derived insights collapse -->
            <div
              v-if="entry.derived?.requirements?.length
                || entry.derived?.recommendations?.length
                || entry.derived?.antiPatterns?.length"
              class="collapse collapse-arrow bg-base-100 rounded-lg"
            >
              <input type="checkbox" />
              <div class="collapse-title text-xs font-medium py-2 min-h-0">
                <Icon name="mingcute:sparkles-2-line" class="text-sm mr-1" />
                Извлечённые инсайты
              </div>
              <div class="collapse-content text-xs space-y-2 px-4 pb-3">
                <!-- Requirements -->
                <div v-if="entry.derived.requirements?.length">
                  <span class="font-semibold text-info">Требования:</span>
                  <ul class="list-disc list-inside mt-1 space-y-0.5 text-base-content/70">
                    <li v-for="(req, i) in entry.derived.requirements" :key="i">
                      {{ req }}
                    </li>
                  </ul>
                </div>

                <!-- Recommendations -->
                <div v-if="entry.derived.recommendations?.length">
                  <span class="font-semibold text-success">Рекомендации:</span>
                  <ul class="list-disc list-inside mt-1 space-y-0.5 text-base-content/70">
                    <li v-for="(rec, i) in entry.derived.recommendations" :key="i">
                      {{ rec }}
                    </li>
                  </ul>
                </div>

                <!-- Anti-patterns -->
                <div v-if="entry.derived.antiPatterns?.length">
                  <span class="font-semibold text-warning">Антипаттерны:</span>
                  <ul class="list-disc list-inside mt-1 space-y-0.5 text-base-content/70">
                    <li v-for="(ap, i) in entry.derived.antiPatterns" :key="i">
                      {{ ap }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
