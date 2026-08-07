<script setup lang="ts">
/**
 * Встроенная форма trendwatcher-конфига (без профиля в БД).
 * Получает отфильтрованный config (без profileMode/profileId) и эмитит update-события.
 */
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const POPULAR_ACTORS = [
  { value: 'clockworks/tiktok-scraper', label: 'Clockworks — TikTok' },
  { value: 'apidojo/tiktok-scraper', label: 'Apidojo — TikTok' },
  { value: 'apify/instagram-scraper', label: 'Apify — Instagram' },
  { value: 'streamers/youtube-scraper', label: 'Streamers — YouTube' },
  { value: 'apidojo/youtube-scraper', label: 'Apidojo — YouTube' },
]

// Никогда не существовавшие / de-listed акторы Apify Store.
// Автоматически маппим на рабочие альтернативы при открытии формы — иначе
// пользователь видит valid option в dropdown, а config.actorId остаётся сломанным.
const DEPRECATED_ACTOR_MAP: Record<string, string> = {
  'apify/tiktok-scraper': 'clockworks/tiktok-scraper',
  'apify/youtube-scraper': 'streamers/youtube-scraper',
}

watchEffect(() => {
  const current = props.config.actorId
  if (typeof current === 'string' && current in DEPRECATED_ACTOR_MAP) {
    emit('update', 'actorId', DEPRECATED_ACTOR_MAP[current])
  }
})

const platforms = ['tiktok', 'instagram', 'youtube'] as const
const platformLabels: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

const GEO_OPTIONS = [
  { value: 'US', label: 'US — США' },
  { value: 'GB', label: 'GB — Великобритания' },
  { value: 'DE', label: 'DE — Германия' },
  { value: 'FR', label: 'FR — Франция' },
  { value: 'NL', label: 'NL — Нидерланды' },
  { value: 'ES', label: 'ES — Испания' },
  { value: 'IT', label: 'IT — Италия' },
  { value: 'BR', label: 'BR — Бразилия' },
  { value: 'IN', label: 'IN — Индия' },
  { value: 'JP', label: 'JP — Япония' },
  { value: 'KR', label: 'KR — Южная Корея' },
  { value: 'TR', label: 'TR — Турция' },
  { value: 'KZ', label: 'KZ — Казахстан' },
  { value: 'UA', label: 'UA — Украина' },
  { value: 'BY', label: 'BY — Беларусь' },
]

const LANGUAGE_OPTIONS = [
  { value: 'EN', label: 'EN — English' },
  { value: 'RU', label: 'RU — Русский' },
  { value: 'ES', label: 'ES — Español' },
  { value: 'DE', label: 'DE — Deutsch' },
  { value: 'FR', label: 'FR — Français' },
  { value: 'PT', label: 'PT — Português' },
  { value: 'JA', label: 'JA — 日本語' },
  { value: 'KO', label: 'KO — 한국어' },
]

const selectedPlatforms = computed<string[]>(() => {
  const val = props.config.platforms
  if (Array.isArray(val)) return val
  if (typeof val === 'string' && val) return val.split(',').map((s: string) => s.trim())
  return []
})

const keywords = computed<string[]>(() => {
  const val = props.config.keywords
  if (Array.isArray(val)) return val
  if (typeof val === 'string' && val) return val.split(',').map((s: string) => s.trim())
  return []
})

function togglePlatform(p: string) {
  const current = [...selectedPlatforms.value]
  const idx = current.indexOf(p)
  if (idx >= 0) current.splice(idx, 1)
  else current.push(p)
  emit('update', 'platforms', current)
}

function onNumber(key: string, raw: string | number) {
  if (raw === '') {
    emit('update', key, null)
    return
  }
  const num = Number(raw)
  emit('update', key, Number.isFinite(num) ? num : null)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 1. Источник/скрапер -->
    <UiField label="Источник / Apify-актор">
      <UiSelect
        :model-value="config.actorId || 'clockworks/tiktok-scraper'"
        :options="POPULAR_ACTORS"
        @update:model-value="(v) => emit('update', 'actorId', v)"
      />
      <SharedFieldHint text="Какой scraper запускать на Apify. Платный ресурс — проверяйте токен." />
    </UiField>

    <!-- 2. Платформы -->
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
      <SharedFieldHint text="Одна или несколько. Совместимость с выбранным актором — на вашей совести." />
    </UiField>

    <!-- 3. Ключевые слова -->
    <UiField label="Ключевые слова">
      <SharedTagInput
        :model-value="keywords"
        placeholder="Добавить ключевое слово"
        @update:model-value="(v) => emit('update', 'keywords', v)"
      />
      <SharedFieldHint text="Фразы или хештеги. Чем точнее — тем релевантнее." example="фитнес, здоровое питание, тренировки дома" />
    </UiField>

    <!-- 4. Гео/Язык -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <UiField label="Гео">
        <UiSelect
          :model-value="config.geo || 'US'"
          :options="GEO_OPTIONS"
          @update:model-value="(v) => emit('update', 'geo', v)"
        />
      </UiField>
      <UiField label="Язык">
        <UiSelect
          :model-value="config.language || 'EN'"
          :options="LANGUAGE_OPTIONS"
          @update:model-value="(v) => emit('update', 'language', v)"
        />
      </UiField>
    </div>

    <!-- 5. Пороговые метрики -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <UiField label="Мин. просмотров">
        <UiInput
          type="number"
          min="0"
          placeholder="0"
          :model-value="config.viewCountMin ?? ''"
          @update:model-value="(v) => onNumber('viewCountMin', v)"
        />
        <SharedFieldHint text="Нижняя граница вирусности. Оставьте пустым — фильтр отключён." />
      </UiField>
      <UiField label="Макс. просмотров">
        <UiInput
          type="number"
          min="0"
          placeholder="Без ограничений"
          :model-value="config.viewCountMax ?? ''"
          @update:model-value="(v) => onNumber('viewCountMax', v)"
        />
      </UiField>
    </div>

    <!-- 6. Лимит результатов -->
    <UiField label="Макс. результатов">
      <UiInput
        type="number"
        min="1"
        max="100"
        placeholder="20"
        :model-value="config.maxItems ?? 20"
        @update:model-value="(v) => onNumber('maxItems', v)"
      />
      <SharedFieldHint text="1–100. Влияет на стоимость Apify-запуска." />
    </UiField>

    <!-- 7. Стратегия -->
    <UiField label="Стратегия">
      <SharedTaxonomyPicker
        type="strategy"
        :model-value="config.preset ?? null"
        @update:model-value="(v) => emit('update', 'preset', v)"
      />
      <SharedFieldHint text="Опционально. Помогает направить поиск трендов в нужное русло." />
    </UiField>

    <!-- 8. Сохранение как профиль -->
    <UiField label="Имя inline-конфига">
      <UiInput
        placeholder="[pipeline-inline] …"
        :model-value="config.inlineName ?? ''"
        @update:model-value="(v) => emit('update', 'inlineName', v)"
      />
      <SharedFieldHint text="Используется только в истории запусков. Для сохранения как переиспользуемый профиль — включите тумблер ниже." />
    </UiField>

    <div class="flex items-start justify-between gap-3">
      <span class="min-w-0">
        <span class="block font-medium">Сохранить как переиспользуемый профиль</span>
        <span class="block text-micro text-subtle">
          При запуске конвейера inline-конфиг превратится в обычный профиль и появится в модуле Трендвотчер.
        </span>
      </span>
      <UiToggle
        :model-value="config.saveAsProfile === true"
        @update:model-value="(v) => emit('update', 'saveAsProfile', v)"
      />
    </div>
  </div>
</template>
