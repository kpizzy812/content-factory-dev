<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const metricOptions = ['views', 'likes', 'shares', 'comments', 'watchTime', 'ctr'] as const
const metricLabels: Record<string, string> = {
  views: 'Просмотры',
  likes: 'Лайки',
  shares: 'Репосты',
  comments: 'Комментарии',
  watchTime: 'Время просмотра',
  ctr: 'CTR',
}

function toggleMetric(metric: string, checked: boolean) {
  const current: string[] = props.config.metrics || []
  const updated = checked
    ? [...current, metric]
    : current.filter((m: string) => m !== metric)
  emit('update', 'metrics', updated)
}
</script>

<template>
  <UiField label="Метрики">
    <div class="flex flex-col gap-1.5">
      <UiCheckbox
        v-for="metric in metricOptions"
        :key="metric"
        :model-value="(config.metrics || []).includes(metric)"
        :label="metricLabels[metric]"
        @update:model-value="(v) => toggleMetric(metric, v)"
      />
    </div>
    <SharedFieldHint text="Какие показатели собирать. Просмотры и лайки — базовые. CTR и время просмотра — продвинутые." />
  </UiField>

  <UiField label="Порог для Reference">
    <UiInput
      :model-value="config.referenceThreshold || ''"
      type="number"
      placeholder="10000 просмотров"
      @update:model-value="(v) => emit('update', 'referenceThreshold', Number(v))"
    />
    <SharedFieldHint text="Минимальное значение метрики, при котором ролик считается успешным." example="10000" />
  </UiField>
</template>
