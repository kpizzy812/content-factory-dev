<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const force = computed(() => Boolean(props.config.force ?? false))
const concurrency = computed(() => Number(props.config.concurrency ?? 2))

function onForceChange(event: Event) {
  emit('update', 'force', (event.target as HTMLInputElement).checked)
}

function onConcurrencyChange(event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v >= 1 && v <= 3) {
    emit('update', 'concurrency', v)
  }
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Принудительный пере-анализ</legend>
    <label class="label cursor-pointer justify-start gap-2 p-0">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="force"
        @change="onForceChange"
      />
      <span class="text-xs">Игнорировать TTL и переанализировать заново</span>
    </label>
    <SharedFieldHint
      text="По умолчанию анализ свежий 30 дней — повторный запуск пропускает видео. Включите чтобы перезапустить даже если TTL не истёк."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Параллелизм (concurrency)</legend>
    <input
      type="number"
      class="input input-sm w-full"
      min="1"
      max="3"
      :value="concurrency"
      @change="onConcurrencyChange"
    />
    <SharedFieldHint
      text="Сколько видео анализировать одновременно. Больше — быстрее, но выше нагрузка на Anthropic API. Range 1..3, default 2."
    />
  </fieldset>

  <div class="p-2 rounded-box bg-base-200 text-[10px] text-base-content/60 leading-relaxed">
    <p>
      Принимает upstream <code>driveFileIds</code> (от Drive Scanner) или <code>videoIds</code>.
      Импортирует Drive-файлы в Video и запускает marketing-разбор кадров.
      Результат — <code>VideoAnalysisFramePass</code> в <code>Video.analysisData</code>,
      используется downstream нодой Caption Generator.
    </p>
  </div>
</template>
