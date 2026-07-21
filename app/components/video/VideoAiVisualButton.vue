<script setup lang="ts">
import type { VisualStyleResult } from '~~/shared/types/agents'

const props = defineProps<{
  scenarioHook: string
  scenarioBody: string
  scenarioTitle: string
  scenarioCta: string
  appName: string
  cacheScope?: string
}>()

const { loading, error, result, suggest } = useAiSuggest<VisualStyleResult>(
  '/api/ai/suggest/visual-style',
  { cacheKey: () => (props.cacheScope ? `video:${props.cacheScope}:visual-style` : null) },
)

const showResult = ref(false)

async function handleSuggest() {
  const res = await suggest({
    scenarioHook: props.scenarioHook,
    scenarioBody: props.scenarioBody,
    scenarioTitle: props.scenarioTitle,
    scenarioCta: props.scenarioCta,
    appName: props.appName,
  })
  if (res) {
    showResult.value = true
  }
}
</script>

<template>
  <div class="space-y-2">
    <button
      class="btn btn-sm btn-secondary gap-1"
      :disabled="loading"
      @click="handleSuggest"
    >
      <span v-if="loading" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:sparkles-2-line" />
      AI: Визуальный стиль
    </button>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <div v-if="result && showResult" class="collapse collapse-arrow bg-base-200">
      <input v-model="showResult" type="checkbox" />
      <div class="collapse-title font-medium text-sm">
        AI-рекомендация визуального стиля
      </div>
      <div class="collapse-content space-y-3 text-sm">
        <div>
          <p class="font-semibold text-base-content/60 text-xs uppercase">Настроение</p>
          <p>{{ result.mood }}</p>
        </div>
        <div>
          <p class="font-semibold text-base-content/60 text-xs uppercase">Освещение</p>
          <p>{{ result.lighting }}</p>
        </div>
        <div>
          <p class="font-semibold text-base-content/60 text-xs uppercase">Персонаж</p>
          <p>{{ result.characterDescription }}</p>
        </div>
        <div v-if="result.colorPalette?.length">
          <p class="font-semibold text-base-content/60 text-xs uppercase">Палитра</p>
          <div class="flex gap-1">
            <span
              v-for="color in result.colorPalette"
              :key="color"
              class="w-6 h-6 rounded-full border border-base-300"
              :style="{ backgroundColor: color }"
            />
          </div>
        </div>
        <div v-if="result.sceneDescriptions?.length">
          <p class="font-semibold text-base-content/60 text-xs uppercase">Сцены</p>
          <ul class="space-y-1">
            <li v-for="scene in result.sceneDescriptions" :key="scene.sceneNumber" class="text-xs">
              <span class="font-medium">Сцена {{ scene.sceneNumber }}:</span>
              {{ scene.description }} ({{ scene.duration }}, {{ scene.cameraAngle }})
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
