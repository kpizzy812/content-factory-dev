<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const modes = [
  { value: 'input', label: 'Из потока', icon: 'mingcute:route-line', description: 'Анализирует URL из предыдущего блока. Подключите после Трендвотчера — блок автоматически найдёт URL в данных.' },
  { value: 'url', label: 'По URL', icon: 'mingcute:link-line', description: 'Анализирует один конкретный URL видео. Подходит для ручного тестирования или статической ссылки.' },
  { value: 'fetch', label: 'Из базы', icon: 'mingcute:inbox-line', description: 'Загружает ранее проанализированные идеи из базы данных. Полезно для повторного использования в новых сценариях.' },
] as const

const statusOptions = [
  { value: 'ready', label: 'Готовые к использованию' },
  { value: 'pending', label: 'Ожидающие обработки' },
  { value: 'completed', label: 'Завершённые' },
]

const languageOptions = [
  { value: 'EN', label: 'EN — English' },
  { value: 'RU', label: 'RU — Русский' },
  { value: 'ES', label: 'ES — Español' },
  { value: 'DE', label: 'DE — Deutsch' },
  { value: 'FR', label: 'FR — Français' },
]

const currentMode = computed(() => {
  const m = modes.find(m => m.value === props.config.mode)
  return m ?? modes[0]
})
</script>

<template>
  <!-- Режим работы -->
  <UiField label="Режим работы">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="m in modes"
        :key="m.value"
        :variant="(config.mode || 'input') === m.value ? 'primary' : 'secondary'"
        @click="emit('update', 'mode', m.value)"
      >
        <Icon :name="m.icon" />
        {{ m.label }}
      </UiButton>
    </div>
    <p class="mt-1.5 flex items-start gap-1.5 rounded-md border border-info-border bg-info-bg px-2 py-1.5 text-micro text-muted">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      {{ currentMode.description }}
    </p>
  </UiField>

  <!-- Режим «Из потока» -->
  <template v-if="(config.mode || 'input') === 'input'">
    <UiField label="Поле с URL (необязательно)">
      <UiInput
        :model-value="config.urlField || ''"
        placeholder="Авто: sourceUrl, videoUrl, url"
        @update:model-value="(v) => emit('update', 'urlField', v)"
      />
      <SharedFieldHint text="Имя поля во входных данных, содержащего URL. Если пусто — блок ищет автоматически в trends[].sourceUrl, videoUrl, url." />
    </UiField>

    <UiField label="Лимит">
      <UiInput
        type="number"
        min="1"
        max="20"
        :model-value="config.limit || 5"
        @update:model-value="(v) => emit('update', 'limit', Number(v))"
      />
      <SharedFieldHint text="Максимум URL для обработки за один запуск (1–20). Каждый URL — один вызов AI-анализа." />
    </UiField>

    <UiField label="Язык анализа">
      <UiSelect
        :model-value="config.language || 'EN'"
        :options="languageOptions"
        @update:model-value="(v) => emit('update', 'language', v)"
      />
    </UiField>

    <div class="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5 text-micro text-muted">
      <div class="font-semibold text-fg">Пример цепочки:</div>
      <div class="flex flex-wrap items-center gap-1">
        <span class="rounded-sm border border-info-border bg-info-bg px-1.5 text-info">Трендвотчер</span>
        <Icon name="mingcute:arrow-right-line" class="text-subtle" />
        <span class="rounded-sm border border-accent-border bg-accent-bg px-1.5 text-accent-text">Идея (из потока)</span>
        <Icon name="mingcute:arrow-right-line" class="text-subtle" />
        <span class="rounded-sm border border-warning-border bg-warning-bg px-1.5 text-warning">Сценарии</span>
      </div>
      <div>Трендвотчер находит тренды с URL → Идея анализирует каждый → CreativeBrief передаётся в Сценарии</div>
    </div>
  </template>

  <!-- Режим «По URL» -->
  <template v-else-if="(config.mode || 'input') === 'url'">
    <UiField label="URL видео">
      <UiInput
        :model-value="config.sourceUrl || ''"
        type="url"
        placeholder="https://tiktok.com/@user/video/123"
        @update:model-value="(v) => emit('update', 'sourceUrl', v)"
      />
      <SharedFieldHint text="Ссылка на видео для анализа. TikTok, Instagram, YouTube." />
    </UiField>

    <UiField label="Язык анализа">
      <UiSelect
        :model-value="config.language || 'EN'"
        :options="languageOptions"
        @update:model-value="(v) => emit('update', 'language', v)"
      />
    </UiField>
  </template>

  <!-- Режим «Из базы» -->
  <template v-else>
    <UiField label="Статус идей">
      <UiSelect
        :model-value="config.ideaStatus || 'ready'"
        :options="statusOptions"
        @update:model-value="(v) => emit('update', 'ideaStatus', v)"
      />
      <SharedFieldHint text="Какие идеи загружать из базы. «Готовые» — прошли анализ и готовы к генерации сценариев." />
    </UiField>

    <UiField label="Лимит">
      <UiInput
        type="number"
        min="1"
        max="20"
        :model-value="config.limit || 5"
        @update:model-value="(v) => emit('update', 'limit', Number(v))"
      />
      <SharedFieldHint text="Максимальное количество идей для загрузки (1–20)." />
    </UiField>
  </template>

  <!-- Формат выхода -->
  <div class="flex flex-col gap-0.5 rounded-md border border-border p-2 text-micro text-subtle">
    <div class="font-medium text-muted">Выходные данные:</div>
    <div><code class="font-mono text-fg">ideas[]</code> — массив проанализированных идей с CreativeBrief</div>
    <div><code class="font-mono text-fg">count</code> — количество идей</div>
  </div>
</template>
