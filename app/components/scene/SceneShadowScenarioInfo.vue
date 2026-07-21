<script setup lang="ts">
/**
 * SceneShadowScenarioInfo — информационный баннер на /scenarios/[id] для shadow
 * Scenario (scenarioId с trendId=null, sceneId!==null).
 *
 * НЕ блокирует никакие действия — просто объясняет оператору, что сценарий собран
 * из сцены композитора, и даёт ссылку обратно на /scenes/[sceneId].
 */
defineProps<{
  sceneId: string
  sceneName?: string | null
}>()
</script>

<template>
  <div role="alert" class="alert alert-info alert-soft">
    <Icon name="mingcute:layers-line" class="size-5" />
    <div class="flex-1">
      <h4 class="font-semibold text-sm">
        Сценарий собран из сцены композитора
      </h4>
      <p class="text-xs text-base-content/70">
        AI-переработка работает по контексту сцены и приложения (а не тренда).
        Изменения блоков сцены влияют на следующие итерации rework.
      </p>
    </div>
    <NuxtLink
      :to="`/scenes/${sceneId}`"
      class="btn btn-sm btn-ghost gap-1"
    >
      <Icon name="mingcute:arrow-right-line" class="size-4" />
      Открыть сцену{{ sceneName ? `: ${sceneName}` : '' }}
    </NuxtLink>
  </div>
</template>
