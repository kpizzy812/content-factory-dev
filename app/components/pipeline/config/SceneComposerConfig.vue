<script setup lang="ts">
/**
 * Конфиг pipeline-ноды scene_composer.
 * Выбор app → выбор сцены из библиотеки композитора → output на downstream-блоки.
 */
import type { Scene } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'

const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const { data: appsData } = useFetch<{ data: { id: number, name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])
const appOptions = computed(() => apps.value.map(a => ({ value: a.id, label: a.name })))

const appId = computed(() => Number(props.config.appId) || null)
const mode = computed(() => (props.config.mode as 'fixed' | 'latest' | 'random') ?? 'fixed')

const MODES = [
  { value: 'fixed', label: 'Конкретная', needsApp: false },
  { value: 'latest', label: 'Последняя', needsApp: true },
  { value: 'random', label: 'Случайная', needsApp: true },
] as const

const scenesQuery = computed(() => (appId.value ? { appId: appId.value } : {}))
const { data: scenesData, pending: scenesPending } = useFetch<{ data: Scene[] }>(
  '/api/scenes',
  {
    query: scenesQuery,
    watch: [appId],
    server: false,
    default: () => ({ data: [] }) as any,
  },
)
const scenes = computed<Scene[]>(() => scenesData.value?.data ?? [])

const sceneOptions = computed(() => scenes.value.map(s => ({
  value: s.id,
  label: `${s.name} — ${SCENE_STATUS_LABELS[s.status] ?? s.status}`,
})))

const scenePlaceholder = computed(() => {
  if (!appId.value) return 'Сначала выберите приложение'
  return scenesPending.value ? 'Загрузка…' : 'Выберите сцену'
})

const selectedScene = computed<Scene | null>(() => {
  if (!props.config.sceneId) return null
  return scenes.value.find(s => s.id === props.config.sceneId) ?? null
})

function onAppChange(v: string | number) {
  emit('update', 'appId', Number(v) || null)
  if (props.config.sceneId) emit('update', 'sceneId', null)
}
</script>

<template>
  <UiField label="Приложение *">
    <UiSelect
      :model-value="appId ?? ''"
      :options="appOptions"
      placeholder="Выберите приложение"
      @update:model-value="onAppChange"
    />
  </UiField>

  <UiField label="Стратегия выбора">
    <div class="flex rounded-md border border-border bg-card p-0.5">
      <button
        v-for="m in MODES"
        :key="m.value"
        type="button"
        :disabled="m.needsApp && !appId"
        class="h-6 flex-1 rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="[
          mode === m.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg',
          m.needsApp && !appId ? 'cursor-not-allowed text-subtle' : 'cursor-pointer',
        ]"
        @click="emit('update', 'mode', m.value)"
      >{{ m.label }}</button>
    </div>
  </UiField>

  <UiField v-if="mode === 'fixed'" label="Сцена *">
    <UiSelect
      :model-value="config.sceneId ?? ''"
      :options="sceneOptions"
      :placeholder="scenePlaceholder"
      :disabled="!appId || scenesPending"
      @update:model-value="(v) => emit('update', 'sceneId', v || null)"
    />
    <p v-if="appId && !scenesPending && scenes.length === 0" class="mt-1 text-micro text-warning">
      Нет сцен. Создайте в разделе «Композитор сцен».
    </p>
  </UiField>

  <div
    v-if="selectedScene?.promptCompiled"
    class="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5"
  >
    <div class="text-micro font-semibold tracking-wider text-subtle uppercase">
      Превью промпта сцены
    </div>
    <p class="line-clamp-4 font-mono text-sm leading-relaxed">
      {{ selectedScene.promptCompiled }}
    </p>
    <NuxtLink :to="`/scenes/${selectedScene.id}`" target="_blank" class="text-micro text-accent-text">
      Открыть композитор →
    </NuxtLink>
  </div>

  <p class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted">
    <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
    <span>
      Output: <code class="font-mono text-fg">scene</code>,
      <code class="font-mono text-fg">sceneId</code>,
      <code class="font-mono text-fg">compiledPrompt</code>,
      <code class="font-mono text-fg">referenceImageUrls</code>,
      <code class="font-mono text-fg">characterIds</code>. Подаётся на Сценарий или Видео.
    </span>
  </p>
</template>
