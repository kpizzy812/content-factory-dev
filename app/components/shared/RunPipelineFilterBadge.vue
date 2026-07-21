<script setup lang="ts">
/**
 * Бейджи активных фильтров по пайплайну и запуску.
 *
 * Показывает два отдельных бейджа (runId / pipelineId) с крестиками для сброса.
 * Используется на страницах юнитов (scenarios, trends, videos, uploads, ideas,
 * analytics) для визуализации фильтрации из кнопки «К юниту» монитора исполнений.
 */
interface Props {
  runId?: number
  pipelineId?: number
}

defineProps<Props>()

defineEmits<{
  clearRun: []
  clearPipeline: []
}>()
</script>

<template>
  <div v-if="runId || pipelineId" class="flex items-center gap-2 flex-wrap">
    <span v-if="runId" class="badge badge-outline badge-sm gap-1">
      <Icon name="mingcute:play-circle-line" class="text-xs" />
      Запуск #{{ runId }}
      <button class="btn btn-ghost btn-xs btn-circle" aria-label="Сбросить фильтр запуска" @click="$emit('clearRun')">
        <Icon name="mingcute:close-line" />
      </button>
    </span>

    <span v-if="pipelineId" class="badge badge-outline badge-sm gap-1">
      <Icon name="mingcute:git-branch-line" class="text-xs" />
      Конвейер #{{ pipelineId }}
      <button class="btn btn-ghost btn-xs btn-circle" aria-label="Сбросить фильтр конвейера" @click="$emit('clearPipeline')">
        <Icon name="mingcute:close-line" />
      </button>
    </span>
  </div>
</template>
