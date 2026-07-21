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
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Метрики</legend>
    <div class="space-y-1">
      <label
        v-for="metric in metricOptions"
        :key="metric"
        class="flex items-center gap-2 cursor-pointer"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          :checked="(config.metrics || []).includes(metric)"
          @change="toggleMetric(metric, ($event.target as HTMLInputElement).checked)"
        />
        <span class="text-xs">{{ metricLabels[metric] }}</span>
      </label>
    </div>
    <SharedFieldHint text="Какие показатели собирать. Просмотры и лайки — базовые. CTR и время просмотра — продвинутые." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Порог для Reference</legend>
    <input
      :value="config.referenceThreshold || ''"
      type="number"
      class="input input-sm w-full"
      placeholder="10000 просмотров"
      @input="emit('update', 'referenceThreshold', Number(($event.target as HTMLInputElement).value))"
    />
    <SharedFieldHint text="Минимальное значение метрики, при котором ролик считается успешным." example="10000" />
  </fieldset>
</template>
