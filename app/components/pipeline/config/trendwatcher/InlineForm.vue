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
  { id: 'clockworks/tiktok-scraper', label: 'Clockworks — TikTok' },
  { id: 'apidojo/tiktok-scraper', label: 'Apidojo — TikTok' },
  { id: 'apify/instagram-scraper', label: 'Apify — Instagram' },
  { id: 'streamers/youtube-scraper', label: 'Streamers — YouTube' },
  { id: 'apidojo/youtube-scraper', label: 'Apidojo — YouTube' },
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

function onNumber(key: string, e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (raw === '') {
    emit('update', key, null)
    return
  }
  const num = Number(raw)
  emit('update', key, Number.isFinite(num) ? num : null)
}
</script>

<template>
  <div class="space-y-3">
    <!-- 1. Источник/скрапер -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Источник / Apify-актор</legend>
      <select
        class="select select-sm w-full"
        :value="config.actorId || 'clockworks/tiktok-scraper'"
        @change="emit('update', 'actorId', ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="a in POPULAR_ACTORS"
          :key="a.id"
          :value="a.id"
        >
          {{ a.label }}
        </option>
      </select>
      <SharedFieldHint text="Какой scraper запускать на Apify. Платный ресурс — проверяйте токен." />
    </fieldset>

    <!-- 2. Платформы -->
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
      <SharedFieldHint text="Одна или несколько. Совместимость с выбранным actor'ом — на вашей совести." />
    </fieldset>

    <!-- 3. Keywords -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Ключевые слова</legend>
      <SharedTagInput
        :model-value="keywords"
        placeholder="Добавить ключевое слово"
        @update:model-value="(v) => emit('update', 'keywords', v)"
      />
      <SharedFieldHint text="Фразы или хештеги. Чем точнее — тем релевантнее." example="фитнес, здоровое питание, тренировки дома" />
    </fieldset>

    <!-- 4. Гео/Язык -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Гео</legend>
        <select
          class="select select-sm w-full"
          :value="config.geo || 'US'"
          @change="emit('update', 'geo', ($event.target as HTMLSelectElement).value)"
        >
          <option value="US">US — США</option>
          <option value="GB">GB — Великобритания</option>
          <option value="DE">DE — Германия</option>
          <option value="FR">FR — Франция</option>
          <option value="NL">NL — Нидерланды</option>
          <option value="ES">ES — Испания</option>
          <option value="IT">IT — Италия</option>
          <option value="BR">BR — Бразилия</option>
          <option value="IN">IN — Индия</option>
          <option value="JP">JP — Япония</option>
          <option value="KR">KR — Южная Корея</option>
          <option value="TR">TR — Турция</option>
          <option value="KZ">KZ — Казахстан</option>
          <option value="UA">UA — Украина</option>
          <option value="BY">BY — Беларусь</option>
        </select>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Язык</legend>
        <select
          class="select select-sm w-full"
          :value="config.language || 'EN'"
          @change="emit('update', 'language', ($event.target as HTMLSelectElement).value)"
        >
          <option value="EN">EN — English</option>
          <option value="RU">RU — Русский</option>
          <option value="ES">ES — Español</option>
          <option value="DE">DE — Deutsch</option>
          <option value="FR">FR — Français</option>
          <option value="PT">PT — Português</option>
          <option value="JA">JA — 日本語</option>
          <option value="KO">KO — 한국어</option>
        </select>
      </fieldset>
    </div>

    <!-- 5. Пороговые метрики -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Мин. просмотров</legend>
        <input
          type="number"
          class="input input-sm w-full"
          placeholder="0"
          min="0"
          :value="config.viewCountMin ?? ''"
          @input="onNumber('viewCountMin', $event)"
        >
        <SharedFieldHint text="Нижняя граница вирусности. Оставьте пустым — фильтр отключён." />
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Макс. просмотров</legend>
        <input
          type="number"
          class="input input-sm w-full"
          placeholder="Без ограничений"
          min="0"
          :value="config.viewCountMax ?? ''"
          @input="onNumber('viewCountMax', $event)"
        >
      </fieldset>
    </div>

    <!-- 6. Лимит результатов -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Макс. результатов</legend>
      <input
        type="number"
        class="input input-sm w-full"
        placeholder="20"
        min="1"
        max="100"
        :value="config.maxItems ?? 20"
        @input="onNumber('maxItems', $event)"
      >
      <SharedFieldHint text="1–100. Влияет на стоимость Apify-запуска." />
    </fieldset>

    <!-- 7. Стратегия -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Стратегия</legend>
      <SharedTaxonomyPicker
        type="strategy"
        :model-value="config.preset ?? null"
        @update:model-value="(v) => emit('update', 'preset', v)"
      />
      <SharedFieldHint text="Опционально. Помогает направить поиск трендов в нужное русло." />
    </fieldset>

    <!-- 8. Сохранение как профиль -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Имя inline-конфига</legend>
      <input
        type="text"
        class="input input-sm w-full"
        placeholder="[pipeline-inline] ..."
        :value="config.inlineName ?? ''"
        @input="emit('update', 'inlineName', ($event.target as HTMLInputElement).value)"
      >
      <SharedFieldHint text="Используется только в истории runs. Для сохранения как переиспользуемый профиль — включите тумблер ниже." />
    </fieldset>

    <label class="label cursor-pointer justify-start gap-2 pl-0">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.saveAsProfile === true"
        @change="emit('update', 'saveAsProfile', ($event.target as HTMLInputElement).checked)"
      >
      <span class="label-text text-xs">
        Сохранить как переиспользуемый профиль
        <span class="block text-base-content/60">
          При запуске конвейера inline-конфиг превратится в обычный профиль и появится в модуле Трендвотчер.
        </span>
      </span>
    </label>
  </div>
</template>
