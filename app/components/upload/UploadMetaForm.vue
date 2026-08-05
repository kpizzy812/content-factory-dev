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
  <div class="flex flex-col gap-3">
    <UiField label="Название">
      <UiInput
        v-model="title"
        placeholder="Заголовок ролика"
        @input="emit('edit:title')"
      />
    </UiField>

    <div>
      <div class="mb-[5px] flex items-center gap-2">
        <span class="text-[11.5px] text-muted">Описание</span>
        <SharedAiSuggestButton :loading="descriptionAi.loading.value" @click="suggestDescription" />
      </div>
      <UiTextarea
        v-model="description"
        :rows="3"
        placeholder="Описание ролика"
        @input="emit('edit:description')"
      />
    </div>

    <div>
      <div class="mb-[5px] flex items-center gap-2">
        <span class="text-[11.5px] text-muted">Хэштеги</span>
        <SharedAiSuggestButton :loading="keywordAi.loading.value" @click="suggestKeywords" />
      </div>
      <UiTextarea
        v-model="hashtagsRaw"
        :rows="2"
        placeholder="тренд, вирусное, контент — через запятую"
        @input="emit('edit:hashtags')"
      />
    </div>

    <UiField label="Запланировать" hint="Необязательно — без даты ролик уйдёт сразу">
      <UiInput v-model="scheduledAt" type="datetime-local" />
      <UiButton
        variant="ghost"
        class="mt-1"
        :loading="postingTimeAi.loading.value"
        @click="suggestPostingTime"
      >
        <Icon v-if="!postingTimeAi.loading.value" name="mingcute:magic-1-line" />
        Подобрать время
      </UiButton>
      <p v-if="postingTimeSuggestion" class="mt-1 text-sm text-success">
        {{ postingTimeSuggestion }}
      </p>
    </UiField>
  </div>
</template>
