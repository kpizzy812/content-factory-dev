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
]

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Авто (по контексту)' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
]

const selectedPlatforms = computed<string[]>(() => {
  const arr = props.config.platforms
  return Array.isArray(arr) ? arr.filter(p => typeof p === 'string') : ['tiktok']
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
  <UiField label="Платформы">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="p in PLATFORMS"
        :key="p.value"
        :variant="selectedPlatforms.includes(p.value) ? 'primary' : 'secondary'"
        @click="togglePlatform(p.value)"
      >
        {{ p.label }}
      </UiButton>
    </div>
    <SharedFieldHint
      text="Для каких соцсетей сгенерировать captions. TikTok: 5 тегов, бюджет 100 символов. YouTube: до 15 тегов, 500 символов. Instagram: до 30 тегов, 100 символов preview."
    />
  </UiField>

  <UiField label="Стиль captions">
    <UiSelect
      :model-value="config.styleVariant || 'viral'"
      :options="STYLE_OPTIONS"
      @update:model-value="(v) => emit('update', 'styleVariant', v)"
    />
    <SharedFieldHint
      text="viral — pattern-interrupt и hook. informative — упор на факты и пользу. storytelling — повествование с микро-аркой."
    />
  </UiField>

  <UiField label="Подсказки стиля (опционально)">
    <UiTextarea
      :model-value="config.styleHints || ''"
      :rows="3"
      placeholder="Например: используй простой язык, без эмодзи, упоминай приложение как «твой второй мозг»."
      @update:model-value="(v) => emit('update', 'styleHints', v)"
    />
    <SharedFieldHint
      text="Короткие подсказки для AI: тон бренда, запреты, форматы. До 500 символов."
      :max-length="500"
      :current-length="(config.styleHints || '').length"
    />
  </UiField>

  <UiField label="Язык captions">
    <UiSelect
      :model-value="config.language || 'auto'"
      :options="LANGUAGE_OPTIONS"
      @update:model-value="(v) => emit('update', 'language', v)"
    />
    <SharedFieldHint
      text="auto — AI определит сам по контексту приложения и сценария. Иначе AI напишет title/description на выбранном языке (хэштеги остаются по конвенции платформы)."
    />
  </UiField>

  <UiField label="Поведение при перезапуске">
    <UiCheckbox
      :model-value="config.forceRegenerate === true"
      label="Перегенерировать если captions уже есть"
      @update:model-value="(v) => emit('update', 'forceRegenerate', v)"
    />
    <SharedFieldHint
      text="Без галки: при повторном запуске pipeline captions для уже сгенерированных платформ (в этом же run scope) переиспользуются без AI-вызова. С галкой: AI вызывается заново независимо."
    />
  </UiField>

  <UiField label="Реакция на превышение лимитов">
    <UiCheckbox
      :model-value="config.failOnNotFitsLimits === true"
      label="Останавливать шаг, если AI не уложился в лимиты платформы"
      @update:model-value="(v) => emit('update', 'failOnNotFitsLimits', v)"
    />
    <SharedFieldHint
      text="Без галки: captions сохраняются с fitsLimits=false, оператор правит вручную (approve blocked). С галкой: step становится failed → даунстрим прерывается, можно retry."
    />
  </UiField>

  <p class="rounded-md border border-border bg-card px-2.5 py-2 text-micro leading-relaxed text-muted">
    Нода сохраняет captions в БД (одна запись на видео и платформу). Чтобы Upload использовал
    их вместо заглушки, оператор должен подтвердить «Утвердить для постинга» на странице видео.
  </p>
</template>
