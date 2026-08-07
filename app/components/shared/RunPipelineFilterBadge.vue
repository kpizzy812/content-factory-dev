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

const CHIP = 'inline-flex h-[22px] items-center gap-1 rounded-sm border border-border bg-card pr-1 pl-2 text-sm text-muted'
</script>

<template>
  <div v-if="runId || pipelineId" class="flex flex-wrap items-center gap-2">
    <span v-if="runId" :class="CHIP">
      <Icon name="mingcute:play-circle-line" class="shrink-0" />
      Запуск #{{ runId }}
      <button
        type="button"
        class="cursor-pointer text-subtle hover:text-danger"
        aria-label="Сбросить фильтр запуска"
        @click="$emit('clearRun')"
      >
        <Icon name="mingcute:close-line" />
      </button>
    </span>

    <span v-if="pipelineId" :class="CHIP">
      <Icon name="mingcute:git-branch-line" class="shrink-0" />
      Конвейер #{{ pipelineId }}
      <button
        type="button"
        class="cursor-pointer text-subtle hover:text-danger"
        aria-label="Сбросить фильтр конвейера"
        @click="$emit('clearPipeline')"
      >
        <Icon name="mingcute:close-line" />
      </button>
    </span>
  </div>
</template>
