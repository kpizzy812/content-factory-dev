<script setup lang="ts">
/**
 * Обратная связь по сценарию, ролику или публикации.
 *
 * История отзывов лежит под формой, а не за вкладкой: без неё человек пишет
 * то же самое второй раз, а извлечённые из прошлых отзывов требования — это
 * готовый ответ на «почему сценарий такой».
 */
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

const props = defineProps<{
  scenarioId?: number
  videoId?: number
  uploadId?: number
}>()

const emit = defineEmits<{ submitted: [] }>()

const feedbackText = ref('')
const isSubmitting = ref(false)
const saved = ref(false)
const errorMessage = ref('')

const queryParams = computed(() => {
  if (props.scenarioId) return { scenarioId: props.scenarioId }
  if (props.videoId) return { videoId: props.videoId }
  if (props.uploadId) return { uploadId: props.uploadId }
  return {}
})

const { data: feedbackList, refresh: refreshFeedback } = useFetch('/api/scenarios/feedback', {
  query: queryParams,
  default: () => [] as FeedbackEntry[],
})

const entries = computed(() => (feedbackList.value ?? []) as FeedbackEntry[])

/** Настроение приводим к общему словарю статусов, своих цветов не заводим. */
const SENTIMENT: Record<string, { label: string, status: 'done' | 'failed' | 'draft' | 'review' }> = {
  positive: { label: 'Позитивный', status: 'done' },
  negative: { label: 'Негативный', status: 'failed' },
  neutral: { label: 'Нейтральный', status: 'draft' },
  mixed: { label: 'Смешанный', status: 'review' },
}

const expanded = ref(new Set<number>())

function toggle(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

function hasInsights(entry: FeedbackEntry) {
  const d = entry.derived
  return !!(d?.requirements?.length || d?.recommendations?.length || d?.antiPatterns?.length)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

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
    saved.value = true
    emit('submitted')
    await refreshFeedback()
    setTimeout(() => { saved.value = false }, 2000)
  }
  catch (err: unknown) {
    errorMessage.value = (err as { data?: { error?: string } })?.data?.error
      ?? (err instanceof Error ? err.message : 'Не удалось отправить отзыв')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">Обратная связь</h2>
      <span v-if="entries.length" class="tnum font-mono text-micro text-subtle">{{ entries.length }}</span>
    </header>

    <form class="flex flex-col gap-2 p-3" @submit.prevent="handleSubmit">
      <UiTextarea
        v-model="feedbackText"
        :rows="3"
        placeholder="Что получилось, что нет, что поменять в следующий раз"
        :disabled="isSubmitting"
      />

      <p v-if="errorMessage" class="text-sm text-danger">{{ errorMessage }}</p>

      <div class="flex items-center gap-2">
        <UiButton
          type="submit"
          variant="primary"
          :loading="isSubmitting"
          :disabled="!feedbackText.trim()"
        >
          Отправить отзыв
        </UiButton>
        <span v-if="saved" class="flex items-center gap-1.5 text-sm text-success">
          <Icon name="mingcute:check-line" />
          Сохранено
        </span>
      </div>
    </form>

    <div v-if="entries.length" class="max-h-80 overflow-y-auto border-t border-divider">
      <article
        v-for="entry in entries"
        :key="entry.id"
        class="border-b border-divider px-3 py-2.5 last:border-b-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="tnum font-mono text-micro text-subtle">{{ formatDate(entry.createdAt) }}</span>
          <UiStatusBadge
            v-if="entry.derived?.sentiment && SENTIMENT[entry.derived.sentiment]"
            :status="SENTIMENT[entry.derived.sentiment]!.status"
            size="xs"
            dot
          />
        </div>

        <p class="mt-1 text-sm whitespace-pre-line">{{ entry.feedbackText }}</p>

        <template v-if="hasInsights(entry)">
          <button
            type="button"
            class="mt-1.5 cursor-pointer text-micro text-subtle hover:text-muted"
            :aria-expanded="expanded.has(entry.id)"
            @click="toggle(entry.id)"
          >
            {{ expanded.has(entry.id) ? 'Скрыть извлечённое' : 'Показать извлечённое' }}
          </button>

          <div v-if="expanded.has(entry.id)" class="mt-2 flex flex-col gap-2 text-sm">
            <div v-if="entry.derived?.requirements?.length">
              <span class="font-medium text-info">Требования</span>
              <ul class="mt-0.5 flex flex-col gap-0.5 text-muted">
                <li v-for="(req, i) in entry.derived.requirements" :key="i">— {{ req }}</li>
              </ul>
            </div>
            <div v-if="entry.derived?.recommendations?.length">
              <span class="font-medium text-success">Рекомендации</span>
              <ul class="mt-0.5 flex flex-col gap-0.5 text-muted">
                <li v-for="(rec, i) in entry.derived.recommendations" :key="i">— {{ rec }}</li>
              </ul>
            </div>
            <div v-if="entry.derived?.antiPatterns?.length">
              <span class="font-medium text-warning">Антипаттерны</span>
              <ul class="mt-0.5 flex flex-col gap-0.5 text-muted">
                <li v-for="(ap, i) in entry.derived.antiPatterns" :key="i">— {{ ap }}</li>
              </ul>
            </div>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>
