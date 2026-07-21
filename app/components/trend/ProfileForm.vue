<script setup lang="ts">
const props = defineProps<{
  initialData?: {
    id?: number
    appId?: number
    name?: string
    actorId?: string
    keywords?: string[]
    platforms?: string[]
    language?: string | null
    geo?: string | null
    viewCountMin?: number | null
    viewCountMax?: number | null
    maxItems?: number
  }
  apps: Array<{ id: number; name: string }>
}>()

const emit = defineEmits<{
  submit: [data: {
    appId: number
    name: string
    actorId: string
    keywords: string[]
    platforms: string[]
    language?: string
    geo?: string
    viewCountMin?: number | null
    viewCountMax?: number | null
    maxItems?: number
  }]
  cancel: []
  testConnection: [actorId: string]
}>()

const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const testMessage = ref('')

defineExpose({ testStatus, testMessage })

const POPULAR_ACTORS = [
  { id: 'clockworks/tiktok-scraper', label: 'Clockworks — TikTok' },
  { id: 'apidojo/tiktok-scraper', label: 'Apidojo — TikTok' },
  { id: 'apify/instagram-scraper', label: 'Apify — Instagram' },
  { id: 'streamers/youtube-scraper', label: 'Streamers — YouTube' },
  { id: 'apidojo/youtube-scraper', label: 'Apidojo — YouTube' },
  { id: 'custom', label: 'Свой актор...' },
]

const PLATFORM_OPTIONS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
]

const form = reactive({
  appId: props.initialData?.appId ?? (props.apps[0]?.id || 0),
  name: props.initialData?.name ?? '',
  actorId: props.initialData?.actorId ?? 'clockworks/tiktok-scraper',
  customActorId: '',
  keywords: [...(props.initialData?.keywords ?? [])],
  platforms: [...(props.initialData?.platforms ?? ['tiktok'])],
  language: props.initialData?.language ?? '',
  geo: props.initialData?.geo ?? '',
  viewCountMin: props.initialData?.viewCountMin ?? null as number | null,
  viewCountMax: props.initialData?.viewCountMax ?? null as number | null,
  maxItems: props.initialData?.maxItems ?? 20,
})

const isCustomActor = computed(() => form.actorId === 'custom')
const isEditing = computed(() => !!props.initialData?.id)

function togglePlatform(platform: string) {
  const idx = form.platforms.indexOf(platform)
  if (idx >= 0) {
    if (form.platforms.length > 1) {
      form.platforms.splice(idx, 1)
    }
  } else {
    form.platforms.push(platform)
  }
}

function handleSubmit() {
  const actorId = isCustomActor.value ? form.customActorId.trim() : form.actorId

  if (!form.name.trim()) return
  if (!form.appId) return
  if (!actorId) return
  if (form.platforms.length === 0) return

  emit('submit', {
    appId: form.appId,
    name: form.name.trim(),
    actorId,
    keywords: form.keywords,
    platforms: form.platforms,
    language: form.language.trim() || undefined,
    geo: form.geo.trim() || undefined,
    viewCountMin: form.viewCountMin,
    viewCountMax: form.viewCountMax,
    maxItems: form.maxItems > 0 ? form.maxItems : 20,
  })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <!-- Название -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Название профиля *</legend>
      <input
        v-model="form.name"
        type="text"
        class="input w-full"
        placeholder="Например: Тренды TikTok по фитнесу"
        required
      >
    </fieldset>

    <!-- Приложение -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Приложение *</legend>
      <select v-model="form.appId" class="select w-full" :disabled="isEditing">
        <option v-for="app in apps" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
    </fieldset>

    <!-- Актор -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Apify-актор *</legend>
      <select v-model="form.actorId" class="select w-full">
        <option v-for="actor in POPULAR_ACTORS" :key="actor.id" :value="actor.id">
          {{ actor.label }}
        </option>
      </select>
      <input
        v-if="isCustomActor"
        v-model="form.customActorId"
        type="text"
        class="input w-full mt-2"
        placeholder="owner/actor-name"
        required
      >
      <!-- Test connection inline -->
      <div class="flex items-center gap-2 mt-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="testStatus === 'testing'"
          @click="emit('testConnection', isCustomActor ? form.customActorId.trim() : form.actorId)"
        >
          <span v-if="testStatus === 'testing'" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:shield-check-line" class="text-sm" />
          Проверить актор
        </button>
        <span
          v-if="testStatus === 'success'"
          class="text-xs text-success flex items-center gap-1"
        >
          <Icon name="mingcute:check-circle-line" class="text-sm" />
          Актор найден, токен валиден
        </span>
        <span
          v-if="testStatus === 'error'"
          class="text-xs text-error flex items-center gap-1"
        >
          <Icon name="mingcute:warning-line" class="text-sm" />
          {{ testMessage }}
        </span>
      </div>
    </fieldset>

    <!-- Keywords -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Ключевые слова</legend>
      <SharedTagInput
        v-model="form.keywords"
        placeholder="Добавьте слово и нажмите Enter"
        :show-ai-button="false"
      />
      <p class="label text-xs">
        Слова для поиска трендового контента
      </p>
    </fieldset>

    <!-- Platforms -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Платформы *</legend>
      <div class="flex gap-3">
        <label
          v-for="p in PLATFORM_OPTIONS"
          :key="p.value"
          class="flex items-center gap-2 cursor-pointer"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-sm checkbox-primary"
            :checked="form.platforms.includes(p.value)"
            @change="togglePlatform(p.value)"
          >
          <span class="text-sm">{{ p.label }}</span>
        </label>
      </div>
    </fieldset>

    <!-- Language + Geo -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Язык</legend>
        <input
          v-model="form.language"
          type="text"
          class="input w-full"
          placeholder="ru, en, es..."
        >
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Гео</legend>
        <input
          v-model="form.geo"
          type="text"
          class="input w-full"
          placeholder="RU, US, DE..."
        >
      </fieldset>
    </div>

    <!-- View count filters + Max items -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Мин. просмотров</legend>
        <input
          v-model.number="form.viewCountMin"
          type="number"
          class="input w-full"
          placeholder="0"
          min="0"
        >
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Макс. просмотров</legend>
        <input
          v-model.number="form.viewCountMax"
          type="number"
          class="input w-full"
          placeholder="Без ограничений"
          min="0"
        >
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Макс. результатов</legend>
        <input
          v-model.number="form.maxItems"
          type="number"
          class="input w-full"
          placeholder="20"
          min="1"
          max="100"
        >
      </fieldset>
    </div>

    <!-- Actions -->
    <div class="flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">
        Отмена
      </button>
      <button type="submit" class="btn btn-primary">
        {{ isEditing ? 'Сохранить' : 'Создать' }}
      </button>
    </div>
  </form>
</template>
