<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube Shorts' },
  { value: 'instagram', label: 'Instagram Reels' },
] as const

const STYLE_OPTIONS = [
  { value: 'viral', label: 'Viral — максимум engagement' },
  { value: 'informative', label: 'Informative — фактологично' },
  { value: 'storytelling', label: 'Storytelling — повествовательно' },
] as const

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Авто (по контексту)' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
] as const

const selectedPlatforms = computed<string[]>(() => {
  const arr = props.config.platforms
  return Array.isArray(arr) ? arr.filter((p) => typeof p === 'string') : ['tiktok']
})

function togglePlatform(platform: string) {
  const current = new Set(selectedPlatforms.value)
  if (current.has(platform)) {
    current.delete(platform)
  } else {
    current.add(platform)
  }
  emit('update', 'platforms', [...current])
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Платформы</legend>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="p in PLATFORMS"
        :key="p.value"
        type="button"
        class="btn btn-sm"
        :class="selectedPlatforms.includes(p.value) ? 'btn-primary' : 'btn-ghost'"
        @click="togglePlatform(p.value)"
      >
        <span class="text-xs">{{ p.label }}</span>
      </button>
    </div>
    <SharedFieldHint
      text="Для каких соцсетей сгенерировать captions. TikTok: 5 тегов, бюджет 100 символов. YouTube: до 15 тегов, 500 символов. Instagram: до 30 тегов, 100 символов preview."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Стиль captions</legend>
    <select
      class="select select-sm w-full"
      :value="config.styleVariant || 'viral'"
      @change="emit('update', 'styleVariant', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in STYLE_OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <SharedFieldHint
      text="viral — pattern-interrupt и hook. informative — упор на факты и пользу. storytelling — повествование с микро-аркой."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Подсказки стиля (опционально)</legend>
    <textarea
      class="textarea textarea-sm w-full"
      rows="3"
      placeholder="Например: используй простой язык, без эмодзи, упоминай ZavodApp как 'твой второй мозг'."
      :value="config.styleHints || ''"
      @input="emit('update', 'styleHints', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <SharedFieldHint
      text="Короткие подсказки для AI: тон бренда, запреты, форматы. До 500 символов."
      :max-length="500"
      :current-length="(config.styleHints || '').length"
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Язык captions</legend>
    <select
      class="select select-sm w-full"
      :value="config.language || 'auto'"
      @change="emit('update', 'language', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in LANGUAGE_OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <SharedFieldHint
      text="auto — AI определит сам по контексту приложения и сценария. Иначе AI напишет title/description на выбранном языке (хэштеги остаются по конвенции платформы)."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Поведение при перезапуске</legend>
    <label class="label cursor-pointer justify-start gap-3 py-1">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="config.forceRegenerate === true"
        @change="emit('update', 'forceRegenerate', ($event.target as HTMLInputElement).checked)"
      />
      <span class="label-text text-sm">Перегенерировать если captions уже есть</span>
    </label>
    <SharedFieldHint
      text="Без галки: при повторном запуске pipeline captions для уже сгенерированных платформ (в этом же run scope) переиспользуются без AI-вызова. С галкой: AI вызывается заново независимо."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Реакция на превышение лимитов</legend>
    <label class="label cursor-pointer justify-start gap-3 py-1">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="config.failOnNotFitsLimits === true"
        @change="emit('update', 'failOnNotFitsLimits', ($event.target as HTMLInputElement).checked)"
      />
      <span class="label-text text-sm">Fail если AI не уложился в лимиты платформы</span>
    </label>
    <SharedFieldHint
      text="Без галки: captions сохраняются с fitsLimits=false, оператор правит вручную (approve blocked). С галкой: step становится failed → даунстрим прерывается, можно retry."
    />
  </fieldset>

  <div class="p-2 rounded-box bg-base-200 text-[10px] text-base-content/60 leading-relaxed">
    <p>
      Нода сохраняет captions в БД (одна запись на видео+платформу). Чтобы Upload использовал
      их вместо placeholder — оператор должен подтвердить «Утвердить для постинга»
      на странице видео.
    </p>
  </div>
</template>
