<script setup lang="ts">
/**
 * Баннер на /scenarios/[id] для сценария, собранного из сцены композитора
 * (trendId=null, sceneId!==null). Ничего не блокирует — объясняет, откуда
 * сценарий взялся и куда идти за его исходником.
 */
defineProps<{
  sceneId: string
  sceneName?: string | null
}>()
</script>

<template>
  <section role="note" class="rounded-lg border border-info-border bg-info-bg p-3">
    <div class="flex flex-wrap items-start gap-2.5">
      <Icon name="mingcute:layers-line" class="mt-0.5 shrink-0 text-lg text-info" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-info">Сценарий собран из сцены композитора</div>
        <p class="mt-1 text-sm text-muted">
          AI-переработка идёт по контексту сцены и приложения, а не тренда. Правки блоков
          сцены попадут в следующие итерации.
        </p>
      </div>
      <NuxtLink :to="`/scenes/${sceneId}`">
        <UiButton>
          Открыть сцену{{ sceneName ? `: ${sceneName}` : '' }}
          <Icon name="mingcute:right-line" />
        </UiButton>
      </NuxtLink>
    </div>
  </section>
</template>
