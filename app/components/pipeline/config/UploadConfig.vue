<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const platforms = ['tiktok', 'instagram', 'youtube'] as const
const platformLabels: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

const instagramModeOptions = [
  { value: 'reel', label: 'Обычный Reel' },
  { value: 'trial_auto', label: 'Trial Reel, авто-публикация при хорошем результате' },
  { value: 'trial_manual', label: 'Trial Reel, решение вручную' },
]

const selectedPlatforms = computed<string[]>(() =>
  Array.isArray(props.config.uploadPlatforms) ? props.config.uploadPlatforms : [],
)

function togglePlatform(p: string) {
  const current = [...selectedPlatforms.value]
  const idx = current.indexOf(p)
  if (idx >= 0) current.splice(idx, 1)
  else current.push(p)
  emit('update', 'uploadPlatforms', current)
}

const hashtags = computed<string[]>(() =>
  Array.isArray(props.config.hashtags) ? props.config.hashtags : [],
)

// === Picker state (две модели в config: socialAccountId | accountGroupId) ===
// Backwards-compat: если в конфиге остался старый `accountGroup`, считаем что mode = group
const initialMode = computed<'account' | 'group'>(() => {
  if (props.config.accountMode === 'account' || props.config.accountMode === 'group') {
    return props.config.accountMode
  }
  if (props.config.accountGroupId || props.config.accountGroup) return 'group'
  return 'account'
})

const accountMode = computed<'account' | 'group'>(() => initialMode.value)

const socialAccountId = computed<number | null>(() =>
  props.config.socialAccountId
    ? Number(props.config.socialAccountId)
    : props.config.accountId
      ? Number(props.config.accountId)
      : null,
)

const accountGroupId = computed<number | null>(() => {
  const v = props.config.accountGroupId ?? props.config.accountGroup
  return v ? Number(v) : null
})

const dispatchMode = computed<'round_robin' | 'all' | 'first_active'>(() => {
  const v = props.config.groupDispatchMode
  if (v === 'round_robin' || v === 'all' || v === 'first_active') return v
  return 'round_robin'
})

function onModeUpdate(mode: 'account' | 'group') {
  emit('update', 'accountMode', mode)
}

function onAccountUpdate(id: number | null) {
  emit('update', 'socialAccountId', id)
  // legacy alias на случай старых executor'ов / валидатора
  emit('update', 'accountId', id)
}

function onGroupUpdate(id: number | null) {
  emit('update', 'accountGroupId', id)
}

function onDispatchUpdate(mode: 'round_robin' | 'all' | 'first_active') {
  emit('update', 'groupDispatchMode', mode)
}

// Description AI
const aiDescLoading = ref(false)
const aiDescPreview = ref<{ text?: string, reasoning?: string } | null>(null)

async function onDescSuggest(prompt: string) {
  aiDescLoading.value = true
  aiDescPreview.value = null
  try {
    const { data } = await $fetch<{ data: { text: string, reasoning?: string } }>('/api/ai/suggest/field', {
      method: 'POST',
      body: {
        prompt,
        fieldType: 'text',
        context: {
          title: props.config.title || undefined,
          platforms: selectedPlatforms.value.join(', ') || undefined,
        },
      },
    })
    if (data?.text) {
      aiDescPreview.value = data
    }
  } finally {
    aiDescLoading.value = false
  }
}

function applyDesc() {
  if (aiDescPreview.value?.text) {
    emit('update', 'description', aiDescPreview.value.text)
  }
  aiDescPreview.value = null
}

function dismissDesc() {
  aiDescPreview.value = null
}

// Tags AI
const aiTagsLoading = ref(false)
const aiTagsPreview = ref<{ items?: string[], reasoning?: string } | null>(null)

async function onTagsSuggest(prompt: string) {
  aiTagsLoading.value = true
  aiTagsPreview.value = null
  try {
    const { data } = await $fetch<{ data: { items: string[], reasoning?: string } }>('/api/ai/suggest/field', {
      method: 'POST',
      body: {
        prompt,
        fieldType: 'tags',
        context: {
          platforms: selectedPlatforms.value.join(', ') || undefined,
        },
      },
    })
    if (data?.items?.length) {
      aiTagsPreview.value = data
    }
  } finally {
    aiTagsLoading.value = false
  }
}

function applyTags() {
  if (aiTagsPreview.value?.items) {
    const merged = [...new Set([...hashtags.value, ...aiTagsPreview.value.items])]
    emit('update', 'hashtags', merged)
  }
  aiTagsPreview.value = null
}

function dismissTags() {
  aiTagsPreview.value = null
}

// Если в платформах выбрана ровно одна — используем её как targetPlatform для AccountPicker
const targetPlatform = computed<string | null>(() =>
  selectedPlatforms.value.length === 1 ? selectedPlatforms.value[0]! : null,
)
</script>

<template>
  <p
    v-if="config.factoryAssignments === true"
    class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-muted"
  >
    <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
    <span>Аккаунты назначает фабрика из активных подключений официальных API.</span>
  </p>

  <template v-if="config.factoryAssignments !== true">
    <UiField label="Приложение">
      <SharedAsyncSelect
        url="/api/admin/apps"
        label-field="name"
        value-field="id"
        :model-value="config.appId ?? null"
        placeholder="Выберите приложение (опционально)"
        @update:model-value="(v) => emit('update', 'appId', v)"
      />
      <SharedFieldHint text="Опционально — фильтрует пикер аккаунтов и групп. Если не выбрано, пикер покажет все доступные." />
    </UiField>

    <UiField label="Адресат публикации">
      <AccountPicker
        :mode="accountMode"
        :social-account-id="socialAccountId"
        :account-group-id="accountGroupId"
        :dispatch-mode="dispatchMode"
        :app-id="config.appId ?? null"
        :target-platform="targetPlatform"
        @update:mode="onModeUpdate"
        @update:social-account-id="onAccountUpdate"
        @update:account-group-id="onGroupUpdate"
        @update:dispatch-mode="onDispatchUpdate"
      />
      <SharedFieldHint text="Один аккаунт или группа с распределением. Группы создаются на странице приложения или в /accounts." />
    </UiField>
  </template>

  <UiField label="Платформы">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="p in platforms"
        :key="p"
        :variant="selectedPlatforms.includes(p) ? 'primary' : 'secondary'"
        @click="togglePlatform(p)"
      >
        {{ platformLabels[p] }}
      </UiButton>
    </div>
    <SharedFieldHint text="Куда публиковать видео. Можно выбрать несколько платформ одновременно." />
  </UiField>

  <UiField v-if="selectedPlatforms.includes('instagram')" label="Режим Instagram Reel">
    <UiSelect
      :model-value="config.instagramPublishMode || 'reel'"
      :options="instagramModeOptions"
      @update:model-value="(v) => emit('update', 'instagramPublishMode', v)"
    />
    <SharedFieldHint
      text="Trial Reel сначала показывается не подписчикам. Режим доступен только для аккаунтов, которым Instagram открыл Trial Reels."
    />
  </UiField>

  <UiField label="Заголовок">
    <UiInput
      :model-value="config.title || ''"
      placeholder="Заголовок видео"
      @update:model-value="(v) => emit('update', 'title', v)"
    />
    <SharedFieldHint text="Название видео. Важно для YouTube, для TikTok и Instagram используется меньше. Будьте кратки и ёмки." example="Как похудеть за 30 дней без диет" />
  </UiField>

  <div>
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      Описание
      <SharedAiSuggestButton
        :loading="aiDescLoading"
        with-prompt
        with-preview
        :preview-data="aiDescPreview"
        placeholder="О чём написать описание..."
        @suggest="onDescSuggest"
        @apply="applyDesc"
        @dismiss="dismissDesc"
      />
    </div>
    <UiTextarea
      :model-value="config.description || ''"
      :rows="3"
      placeholder="Описание видео"
      @update:model-value="(v) => emit('update', 'description', v)"
    />
    <SharedFieldHint text="Текст под видео. Важен для YouTube SEO. В TikTok и Instagram первые строки видны в ленте." />
  </div>

  <div>
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      Хештеги
      <SharedAiSuggestButton
        :loading="aiTagsLoading"
        with-prompt
        with-preview
        :preview-data="aiTagsPreview"
        placeholder="Тематика хештегов..."
        @suggest="onTagsSuggest"
        @apply="applyTags"
        @dismiss="dismissTags"
      />
    </div>
    <SharedTagInput
      :model-value="hashtags"
      placeholder="Добавить хештег"
      @update:model-value="(v) => emit('update', 'hashtags', v)"
    />
    <SharedFieldHint text="Теги для поиска и рекомендаций. 5–15 штук оптимально. Без символа #, система добавит сама." example="фитнес, зож, тренировка" />
  </div>
</template>
