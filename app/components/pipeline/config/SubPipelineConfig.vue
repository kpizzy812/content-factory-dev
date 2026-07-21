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

const modes = [
  { value: 'wait', label: 'Ожидать завершения', description: 'Блокирует родительский конвейер до завершения дочернего' },
  { value: 'fire_and_forget', label: 'Запустить и продолжить', description: 'Не ждёт завершения дочернего конвейера' },
]

const selectedPipeline = computed(() =>
  pipelines.value.find((p: any) => p.id === Number(props.config.pipelineId)),
)
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Целевой конвейер</legend>
    <select
      class="select select-sm w-full"
      :value="config.pipelineId ?? ''"
      @change="emit('update', 'pipelineId', Number(($event.target as HTMLSelectElement).value))"
    >
      <option value="" disabled>Выберите конвейер</option>
      <option
        v-for="p in pipelines"
        :key="p.id"
        :value="p.id"
      >
        {{ p.name }} ({{ p.status === 'active' ? 'активен' : 'неактивен' }})
      </option>
    </select>
    <p v-if="selectedPipeline && selectedPipeline.status !== 'active'" class="label text-xs text-warning">
      <Icon name="mingcute:warning-line" class="inline" />
      Целевой конвейер не активен
    </p>
    <SharedFieldHint text="Какой конвейер запустить как подпроцесс. Убедитесь, что целевой конвейер активен." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Режим выполнения</legend>
    <div class="space-y-2">
      <label
        v-for="mode in modes"
        :key="mode.value"
        class="flex items-start gap-2 cursor-pointer p-2 rounded-box hover:bg-base-200"
        :class="{ 'bg-primary/5 border border-primary/20': config.mode === mode.value }"
      >
        <input
          type="radio"
          name="subPipelineMode"
          class="radio radio-xs radio-primary mt-0.5"
          :checked="(config.mode ?? 'wait') === mode.value"
          @change="emit('update', 'mode', mode.value)"
        />
        <div>
          <div class="text-xs font-medium">{{ mode.label }}</div>
          <div class="text-[10px] text-base-content/50">{{ mode.description }}</div>
        </div>
      </label>
    </div>
    <SharedFieldHint text="Ожидать — блокирует родительский конвейер до конца. Запустить и продолжить — не ждёт результата." />
  </fieldset>

  <div class="rounded-box bg-info/5 border border-info/20 p-2 text-xs text-base-content/60">
    <Icon name="mingcute:information-line" class="inline mr-1 text-info" />
    Входные данные текущего блока будут переданы как input первых нод подконвейера.
    В режиме ожидания, output последнего блока подконвейера станет output этого блока.
  </div>
</template>
