<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

// Load available pipelines
const { data: pipelinesData } = useFetch<{ data: any[] }>('/api/pipelines', {
  params: { perPage: 100 },
})

const pipelines = computed(() => pipelinesData.value?.data ?? [])

const pipelineOptions = computed(() => pipelines.value.map((p: any) => ({
  value: p.id,
  label: `${p.name} (${p.status === 'active' ? 'активен' : 'неактивен'})`,
})))

const modes = [
  { value: 'wait', label: 'Ожидать завершения', description: 'Блокирует родительский конвейер до завершения дочернего' },
  { value: 'fire_and_forget', label: 'Запустить и продолжить', description: 'Не ждёт завершения дочернего конвейера' },
]

const selectedPipeline = computed(() =>
  pipelines.value.find((p: any) => p.id === Number(props.config.pipelineId)),
)
</script>

<template>
  <UiField label="Целевой конвейер">
    <UiSelect
      :model-value="config.pipelineId ?? ''"
      :options="pipelineOptions"
      placeholder="Выберите конвейер"
      @update:model-value="(v) => emit('update', 'pipelineId', Number(v))"
    />
    <p v-if="selectedPipeline && selectedPipeline.status !== 'active'" class="mt-1 flex items-center gap-1 text-micro text-warning">
      <Icon name="mingcute:warning-line" class="shrink-0" />
      Целевой конвейер не активен
    </p>
    <SharedFieldHint text="Какой конвейер запустить как подпроцесс. Убедитесь, что целевой конвейер активен." />
  </UiField>

  <UiField label="Режим выполнения">
    <div class="flex flex-col gap-1.5">
      <label
        v-for="mode in modes"
        :key="mode.value"
        class="flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2"
        :class="(config.mode ?? 'wait') === mode.value
          ? 'border-accent-border bg-accent-bg'
          : 'border-border bg-card hover:bg-raised'"
      >
        <input
          type="radio"
          name="subPipelineMode"
          class="mt-0.5 size-3.5 shrink-0 accent-(--color-accent)"
          :checked="(config.mode ?? 'wait') === mode.value"
          @change="emit('update', 'mode', mode.value)"
        >
        <span class="min-w-0">
          <span class="block font-medium">{{ mode.label }}</span>
          <span class="block text-micro text-subtle">{{ mode.description }}</span>
        </span>
      </label>
    </div>
    <SharedFieldHint text="Ожидать — блокирует родительский конвейер до конца. Запустить и продолжить — не ждёт результата." />
  </UiField>

  <p class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted">
    <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
    <span>
      Входные данные текущего блока будут переданы как input первых нод подконвейера.
      В режиме ожидания output последнего блока подконвейера станет output этого блока.
    </span>
  </p>
</template>
