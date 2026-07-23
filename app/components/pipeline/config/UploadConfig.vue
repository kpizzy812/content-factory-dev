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
const aiDescPreview = ref<{ text?: string; reasoning?: string } | null>(null)

async function onDescSuggest(prompt: string) {
  aiDescLoading.value = true
  aiDescPreview.value = null
  try {
    const { data } = await $fetch<{ data: { text: string; reasoning?: string } }>('/api/ai/suggest/field', {
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
const aiTagsPreview = ref<{ items?: string[]; reasoning?: string } | null>(null)

async function onTagsSuggest(prompt: string) {
  aiTagsLoading.value = true
  aiTagsPreview.value = null
  try {
    const { data } = await $fetch<{ data: { items: string[]; reasoning?: string } }>('/api/ai/suggest/field', {
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
  <div v-if="config.factoryAssignments === true" role="alert" class="alert alert-info alert-soft text-xs">
    <Icon name="mingcute:information-line" />
    <span>Accounts are assigned by the factory from active official API connections.</span>
  </div>

  <template v-if="config.factoryAssignments !== true">
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Приложение</legend>
    <SharedAsyncSelect
      url="/api/admin/apps"
      label-field="name"
      value-field="id"
      :model-value="config.appId ?? null"
      placeholder="Выберите приложение (опционально — для фильтрации пикера)"
      @update:model-value="(v) => emit('update', 'appId', v)"
    />
    <SharedFieldHint text="Опционально — фильтрует пикер аккаунтов и групп. Если не выбрано, пикер покажет все доступные." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Адресат публикации</legend>
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
  </fieldset>
  </template>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Платформы</legend>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="p in platforms"
        :key="p"
        type="button"
        class="btn btn-xs"
        :class="selectedPlatforms.includes(p) ? 'btn-primary' : 'btn-ghost'"
        @click="togglePlatform(p)"
      >
        {{ platformLabels[p] }}
      </button>
    </div>
    <SharedFieldHint text="Куда публиковать видео. Можно выбрать несколько платформ одновременно." />
  </fieldset>

  <fieldset v-if="selectedPlatforms.includes('instagram')" class="fieldset">
    <legend class="fieldset-legend">Режим Instagram Reel</legend>
    <select
      :value="config.instagramPublishMode || 'reel'"
      class="select select-sm w-full"
      @change="emit('update', 'instagramPublishMode', ($event.target as HTMLSelectElement).value)"
    >
      <option value="reel">Обычный Reel</option>
      <option value="trial_auto">Trial Reel, авто-публикация при хорошем результате</option>
      <option value="trial_manual">Trial Reel, решение вручную</option>
    </select>
    <SharedFieldHint
      text="Trial Reel сначала показывается не подписчикам. Режим доступен только для аккаунтов, которым Instagram открыл Trial Reels."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Заголовок</legend>
    <input
      :value="config.title || ''"
      type="text"
      class="input input-sm w-full"
      placeholder="Заголовок видео"
      @input="emit('update', 'title', ($event.target as HTMLInputElement).value)"
    />
    <SharedFieldHint text="Название видео. Важно для YouTube, для TikTok/Instagram используется меньше. Будьте кратки и ёмки." example="Как похудеть за 30 дней без диет" />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend flex items-center gap-1">
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
    </legend>
    <textarea
      :value="config.description || ''"
      class="textarea textarea-sm w-full"
      rows="3"
      placeholder="Описание видео"
      @input="emit('update', 'description', ($event.target as HTMLTextAreaElement).value)"
    />
    <SharedFieldHint text="Текст под видео. Важен для YouTube SEO. В TikTok/Instagram — первые строки видны в ленте." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend flex items-center gap-1">
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
    </legend>
    <SharedTagInput
      :model-value="hashtags"
      placeholder="Добавить хештег"
      @update:model-value="(v) => emit('update', 'hashtags', v)"
    />
    <SharedFieldHint text="Теги для поиска и рекомендаций. 5-15 штук оптимально. Без символа #, система добавит сама." example="фитнес, зож, тренировка" />
  </fieldset>
</template>

