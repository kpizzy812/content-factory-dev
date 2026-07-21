<script setup lang="ts">
/**
 * Универсальный просмотрщик данных шага в двух режимах:
 *   readable — русские названия полей, развёрнутое дерево, переводы enum-значений;
 *   json     — компактный отформатированный JSON в <pre>.
 *
 * Режим управляется родителем (один toggle на страницу — применяется сразу
 * ко всем Input/Output шагов).
 */
import { formatJson } from '~~/shared/utils/pipeline-format'

defineProps<{
  title: string
  data: unknown
  mode: 'readable' | 'json'
}>()
</script>

<template>
  <div>
    <div class="font-semibold mb-1 text-base-content/70">
      {{ title }}:
    </div>

    <pre
      v-if="mode === 'json'"
      class="bg-base-300 p-2 rounded-box overflow-x-auto max-h-40 text-[10px]"
    >{{ formatJson(data) }}</pre>

    <div
      v-else
      class="bg-base-300 rounded-box p-2 overflow-x-auto max-h-56 text-[11px] leading-snug"
    >
      <PipelineMonitorStepDataNode :value="data" />
    </div>
  </div>
</template>
