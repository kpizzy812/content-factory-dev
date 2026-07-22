<script setup lang="ts">
const props = defineProps<{
  nodeType: string
  config: Record<string, any>
  nodeId?: string
  pipelineId?: number
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const retryOptions = [
  { label: '0 (без повторов)', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
]

const delayOptions = [
  { label: '1 сек', value: 1000 },
  { label: '5 сек', value: 5000 },
  { label: '30 сек', value: 30000 },
  { label: '1 мин', value: 60000 },
]

// Должно совпадать с HEAVY_AUTO_RETRY в pipeline-engine.ts:processNode.
// Тяжёлые AI-ноды получают авто-retry 1 без явной настройки пользователем.
const HEAVY_AUTO_RETRY = new Set(['scenario', 'video', 'idea', 'trendwatcher', 'content_strategy'])
const defaultRetryForNode = computed(() =>
  HEAVY_AUTO_RETRY.has(props.nodeType) ? 1 : 0,
)

function onUpdate(key: string, value: any) {
  emit('update', key, value)
}
</script>

<template>
  <!-- Type-specific config -->
  <PipelineConfigTrendwatcherConfig
    v-if="nodeType === 'trendwatcher'"
    :config="config"
    :node-id="nodeId"
    :pipeline-id="pipelineId"
    @update="onUpdate"
  />

  <PipelineConfigContentStrategyConfig
    v-if="nodeType === 'content_strategy'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigScenarioConfig
    v-if="nodeType === 'scenario'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigQualityGateConfig
    v-if="nodeType === 'quality_gate'"
    :config="config"
    @update="onUpdate"
  />
  <PipelineConfigVideoConfig
    v-if="nodeType === 'video'"
    :config="config"
    :node-id="nodeId"
    :pipeline-id="pipelineId"
    @update="onUpdate"
  />

  <PipelineConfigCaptionGeneratorConfig
    v-if="nodeType === 'caption_generator'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigGoogleDriveScannerConfig
    v-if="nodeType === 'google_drive_scanner'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigGoogleDriveUploaderConfig
    v-if="nodeType === 'google_drive_uploader'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigVideoAnalyzerConfig
    v-if="nodeType === 'video_analyzer'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigUploadConfig
    v-if="nodeType === 'upload'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigIdeaConfig
    v-if="nodeType === 'idea'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigAnalyticsConfig
    v-if="nodeType === 'analytics'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigFilterConfig
    v-if="nodeType === 'filter'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigNotificationConfig
    v-if="nodeType === 'notification'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigHttpRequestConfig
    v-if="nodeType === 'http_request'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigCodeConfig
    v-if="nodeType === 'code'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigSetConfig
    v-if="nodeType === 'set'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigIfConfig
    v-if="nodeType === 'if_switch'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigLoopConfig
    v-if="nodeType === 'loop'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigWaitConfig
    v-if="nodeType === 'wait'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigSubPipelineConfig
    v-if="nodeType === 'sub_pipeline'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigCharacterConfig
    v-if="nodeType === 'character'"
    :config="config"
    @update="onUpdate"
  />

  <PipelineConfigSceneComposerConfig
    v-if="nodeType === 'scene_composer'"
    :config="config"
    @update="onUpdate"
  />

  <!-- Common retry config (not for note nodes) -->
  <template v-if="nodeType !== 'note'">
    <div class="divider text-xs text-base-content/50">Повторы при ошибке</div>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">
        Количество повторов
        <span v-if="defaultRetryForNode > 0 && config.retryCount == null" class="badge badge-info badge-xs ml-1">
          по умолчанию {{ defaultRetryForNode }}
        </span>
      </legend>
      <select
        class="select select-sm w-full"
        :value="config.retryCount ?? defaultRetryForNode"
        @change="onUpdate('retryCount', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="opt in retryOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <p v-if="defaultRetryForNode > 0" class="text-[10px] text-base-content/50 mt-0.5">
        AI-ноды получают авто-retry на случай timeout/rate-limit/empty response
      </p>
    </fieldset>

    <fieldset v-if="(config.retryCount ?? defaultRetryForNode) > 0" class="fieldset">
      <legend class="fieldset-legend">Задержка между повторами</legend>
      <select
        class="select select-sm w-full"
        :value="config.retryDelay ?? 5000"
        @change="onUpdate('retryDelay', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="opt in delayOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </fieldset>
  </template>
</template>
