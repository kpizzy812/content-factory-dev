<script setup lang="ts">
import type { PostingTimeResult } from '~~/shared/types/agents'

const props = defineProps<{
  cacheScope?: string
}>()

const emit = defineEmits<{
  'edit:title': []
  'edit:description': []
  'edit:hashtags': []
}>()

const title = defineModel<string>('title', { required: true })
const description = defineModel<string>('description', { required: true })
const hashtagsRaw = defineModel<string>('hashtagsRaw', { required: true })
const scheduledAt = defineModel<string>('scheduledAt', { required: true })

const scope = computed(() => props.cacheScope ?? null)

// AI-помощники
const descriptionAi = useAiSuggest<{ platformVariants: Record<string, { description: string }> }>(
  '/api/ai/suggest/description',
  { cacheKey: () => (scope.value ? `upload:${scope.value}:description` : null) },
)
const keywordAi = useAiSuggest<{ semanticTags: string[]; viralTags: string[] }>(
  '/api/ai/suggest/keywords',
  { cacheKey: () => (scope.value ? `upload:${scope.value}:keywords` : null) },
)
const postingTimeAi = useAiSuggest<PostingTimeResult>(
  '/api/ai/suggest/posting-time',
  { cacheKey: () => (scope.value ? `upload:${scope.value}:posting-time` : null) },
)

const aiCache = useAiCacheStore()
const postingTimeSuggestionKey = computed(() => (scope.value ? `upload:${scope.value}:posting-time-text` : null))
const postingTimeSuggestion = computed<string | null>({
  get() {
    const key = postingTimeSuggestionKey.value
    if (!key) return localPostingTimeSuggestion.value
    const entry = aiCache.getEntry<string>(key)
    return entry?.result ?? null
  },
  set(value) {
    const key = postingTimeSuggestionKey.value
    if (!key) {
      localPostingTimeSuggestion.value = value
      return
    }
    aiCache.setResult<string>(key, value)
  },
})
const localPostingTimeSuggestion = ref<string | null>(null)

async function suggestDescription() {
  const res = await descriptionAi.suggest({
    scenario: { title: title.value, hook: title.value, body: description.value || title.value, cta: '' },
    appName: title.value,
  })
  if (res?.platformVariants) {
    const first = Object.values(res.platformVariants)[0]
    if (first?.description) {
      description.value = first.description
    }
  }
}

async function suggestKeywords() {
  const res = await keywordAi.suggest({ appName: title.value || 'видео' })
  if (res) {
    const tags = [...(res.semanticTags ?? []), ...(res.viralTags ?? [])].slice(0, 10)
    hashtagsRaw.value = tags.join(', ')
  }
}

async function suggestPostingTime() {
  const res = await postingTimeAi.suggest({
    platform: 'tiktok',
    geo: 'Россия',
    niche: title.value || undefined,
  })
  if (res?.bestTimes?.length) {
    const best = res.bestTimes[0]!
    postingTimeSuggestion.value = `${best.day} ${best.hour} -- ${best.reason}`
  }
}
</script>

<template>
  <div class="space-y-3">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Название</legend>
      <input
        v-model="title"
        type="text"
        class="input w-full"
        placeholder="Заголовок видео"
        @input="emit('edit:title')"
      />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center gap-2">
        Описание
        <SharedAiSuggestButton :loading="descriptionAi.loading.value" @click="suggestDescription" />
      </legend>
      <textarea
        v-model="description"
        class="textarea w-full"
        rows="3"
        placeholder="Описание видео"
        @input="emit('edit:description')"
      />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center gap-2">
        Хештеги
        <SharedAiSuggestButton :loading="keywordAi.loading.value" @click="suggestKeywords" />
      </legend>
      <textarea
        v-model="hashtagsRaw"
        class="textarea w-full"
        rows="2"
        placeholder="тренд, вирусное, контент (через запятую)"
        @input="emit('edit:hashtags')"
      />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Запланировать (опционально)</legend>
      <input
        v-model="scheduledAt"
        type="datetime-local"
        class="input w-full"
      />
      <button
        class="btn btn-xs btn-ghost gap-1 mt-1"
        :disabled="postingTimeAi.loading.value"
        @click="suggestPostingTime"
      >
        <span v-if="postingTimeAi.loading.value" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:sparkles-2-line" class="text-sm" />
        Лучшее время
      </button>
      <p v-if="postingTimeSuggestion" class="text-xs text-success mt-1">
        {{ postingTimeSuggestion }}
      </p>
    </fieldset>
  </div>
</template>
