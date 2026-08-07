<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const force = computed(() => Boolean(props.config.force ?? false))
const concurrency = computed(() => Number(props.config.concurrency ?? 2))

function onConcurrencyChange(value: string | number) {
  const v = Number(value)
  if (Number.isFinite(v) && v >= 1 && v <= 3) {
    emit('update', 'concurrency', v)
  }
}
</script>

<template>
  <UiField label="Принудительный пере-анализ">
    <UiCheckbox
      :model-value="force"
      label="Игнорировать TTL и переанализировать заново"
      @update:model-value="(v) => emit('update', 'force', v)"
    />
    <SharedFieldHint
      text="По умолчанию анализ свежий 30 дней — повторный запуск пропускает видео. Включите чтобы перезапустить даже если TTL не истёк."
    />
  </UiField>

  <UiField label="Параллелизм (concurrency)">
    <UiInput
      :model-value="concurrency"
      type="number"
      min="1"
      max="3"
      @update:model-value="onConcurrencyChange"
    />
    <SharedFieldHint
      text="Сколько видео анализировать одновременно. Больше — быстрее, но выше нагрузка на Anthropic API. Range 1..3, default 2."
    />
  </UiField>

  <p class="rounded-md border border-border bg-card px-2.5 py-2 text-micro leading-relaxed text-muted">
    Принимает upstream <code class="font-mono text-fg">driveFileIds</code> (от Drive Scanner) или
    <code class="font-mono text-fg">videoIds</code>. Импортирует Drive-файлы в Video и запускает
    marketing-разбор кадров. Результат — <code class="font-mono text-fg">VideoAnalysisFramePass</code>
    в <code class="font-mono text-fg">Video.analysisData</code>, используется downstream нодой
    Caption Generator.
  </p>
</template>
