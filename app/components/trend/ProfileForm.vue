<script setup lang="ts">
/**
 * Форма профиля парсинга.
 *
 * Приложение при редактировании не меняется: профиль уже привязан к чужим
 * трендам, и перенос между приложениями — это не правка формы, а миграция.
 *
 * Проверка актора стоит прямо у поля: без неё ошибка «актор не найден»
 * всплывает только на первом платном прогоне.
 */
import { platformMeta } from '~/components/ui/platform-meta'

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

const CUSTOM_ACTOR = 'custom'

const ACTOR_OPTIONS = [
  { value: 'clockworks/tiktok-scraper', label: 'Clockworks — TikTok' },
  { value: 'apidojo/tiktok-scraper', label: 'Apidojo — TikTok' },
  { value: 'apify/instagram-scraper', label: 'Apify — Instagram' },
  { value: 'streamers/youtube-scraper', label: 'Streamers — YouTube' },
  { value: 'apidojo/youtube-scraper', label: 'Apidojo — YouTube' },
  { value: CUSTOM_ACTOR, label: 'Свой актор…' },
]

const PLATFORMS = ['tiktok', 'instagram', 'youtube']

const form = reactive({
  appId: props.initialData?.appId ?? (props.apps[0]?.id ?? 0),
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

// Сохранённый актор может не входить в список известных — тогда это «свой»,
// и поле должно открыться с уже подставленным значением.
if (props.initialData?.actorId && !ACTOR_OPTIONS.some(o => o.value === props.initialData!.actorId)) {
  form.customActorId = props.initialData.actorId
  form.actorId = CUSTOM_ACTOR
}

const appOptions = computed(() => props.apps.map(app => ({ value: app.id, label: app.name })))

const isCustomActor = computed(() => form.actorId === CUSTOM_ACTOR)
const isEditing = computed(() => !!props.initialData?.id)

const effectiveActorId = computed(() =>
  isCustomActor.value ? form.customActorId.trim() : form.actorId,
)

const nameError = ref('')
const actorError = ref('')

function togglePlatform(platform: string) {
  const index = form.platforms.indexOf(platform)
  // Последнюю платформу снять нельзя: профиль без площадки парсить нечего
  if (index >= 0) {
    if (form.platforms.length > 1) form.platforms.splice(index, 1)
  }
  else {
    form.platforms.push(platform)
  }
}

function handleSubmit() {
  nameError.value = form.name.trim() ? '' : 'Без названия профиль не найти в списке'
  actorError.value = effectiveActorId.value ? '' : 'Укажите актор Apify'
  if (nameError.value || actorError.value || !form.appId || form.platforms.length === 0) return

  emit('submit', {
    appId: form.appId,
    name: form.name.trim(),
    actorId: effectiveActorId.value,
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
  <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
    <div class="grid gap-3 sm:grid-cols-2">
      <UiField label="Название профиля" :error="nameError">
        <UiInput v-model="form.name" placeholder="Тренды TikTok по фитнесу" />
      </UiField>

      <UiField
        label="Приложение"
        :hint="isEditing ? 'У существующего профиля не меняется: к нему привязаны тренды' : undefined"
      >
        <UiSelect v-model="form.appId" :options="appOptions" :disabled="isEditing" />
      </UiField>
    </div>

    <UiField label="Apify-актор" :error="actorError">
      <UiSelect v-model="form.actorId" :options="ACTOR_OPTIONS" />
      <UiInput
        v-if="isCustomActor"
        v-model="form.customActorId"
        class="mt-1.5"
        mono
        placeholder="owner/actor-name"
      />
      <div class="mt-1.5 flex flex-wrap items-center gap-2">
        <UiButton
          type="button"
          :loading="testStatus === 'testing'"
          @click="emit('testConnection', effectiveActorId)"
        >
          <Icon v-if="testStatus !== 'testing'" name="mingcute:shield-line" />
          Проверить актор
        </UiButton>
        <span v-if="testStatus === 'success'" class="flex items-center gap-1 text-sm text-success">
          <Icon name="mingcute:check-line" />
          Актор найден, токен принят
        </span>
        <span v-else-if="testStatus === 'error'" class="flex items-center gap-1 text-sm text-danger">
          <Icon name="mingcute:alert-line" />
          {{ testMessage }}
        </span>
      </div>
    </UiField>

    <UiField label="Ключевые слова" hint="По ним актор ищет трендовый контент">
      <SharedTagInput
        v-model="form.keywords"
        placeholder="Добавьте слово и нажмите Enter"
        :show-ai-button="false"
      />
    </UiField>

    <UiField label="Площадки" hint="Последнюю снять нельзя — парсить будет нечего">
      <div class="flex flex-wrap gap-3">
        <UiCheckbox
          v-for="platform in PLATFORMS"
          :key="platform"
          :model-value="form.platforms.includes(platform)"
          @update:model-value="togglePlatform(platform)"
        >
          <span class="flex items-center gap-1.5">
            <span class="size-2 rounded-full" :style="{ background: platformMeta(platform).color }" />
            {{ platformMeta(platform).label }}
          </span>
        </UiCheckbox>
      </div>
    </UiField>

    <div class="grid gap-3 sm:grid-cols-2">
      <UiField label="Язык">
        <UiInput v-model="form.language" placeholder="ru, en, es…" />
      </UiField>
      <UiField label="Гео">
        <UiInput v-model="form.geo" placeholder="RU, US, DE…" />
      </UiField>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <UiField label="Просмотров от">
        <UiInput v-model.number="form.viewCountMin" type="number" mono placeholder="0" />
      </UiField>
      <UiField label="Просмотров до">
        <UiInput v-model.number="form.viewCountMax" type="number" mono placeholder="без ограничения" />
      </UiField>
      <UiField label="Результатов за прогон" hint="Каждый результат стоит денег у Apify">
        <UiInput v-model.number="form.maxItems" type="number" mono placeholder="20" />
      </UiField>
    </div>

    <div class="flex justify-end gap-1.5 border-t border-divider pt-3">
      <UiButton type="button" variant="ghost" @click="emit('cancel')">Отмена</UiButton>
      <UiButton type="submit" variant="primary">{{ isEditing ? 'Сохранить' : 'Создать' }}</UiButton>
    </div>
  </form>
</template>
