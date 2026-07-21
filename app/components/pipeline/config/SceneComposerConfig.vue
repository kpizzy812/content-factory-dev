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

const { data: appsData } = useFetch<{ data: { id: number; name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])

const appId = computed(() => Number(props.config.appId) || null)
const mode = computed(() => (props.config.mode as 'fixed' | 'latest' | 'random') ?? 'fixed')

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

const selectedScene = computed<Scene | null>(() => {
  if (!props.config.sceneId) return null
  return scenes.value.find(s => s.id === props.config.sceneId) ?? null
})

function onAppChange(v: number) {
  emit('update', 'appId', v || null)
  if (props.config.sceneId) emit('update', 'sceneId', null)
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Приложение *</legend>
    <select
      class="select select-sm w-full"
      :value="appId ?? ''"
      @change="onAppChange(Number(($event.target as HTMLSelectElement).value))"
    >
      <option value="" disabled>Выберите приложение</option>
      <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
    </select>
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Стратегия выбора</legend>
    <div class="join w-full">
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'fixed' }"
        @click="emit('update', 'mode', 'fixed')"
      >Конкретная</button>
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'latest' }"
        :disabled="!appId"
        @click="emit('update', 'mode', 'latest')"
      >Последняя</button>
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'random' }"
        :disabled="!appId"
        @click="emit('update', 'mode', 'random')"
      >Случайная</button>
    </div>
  </fieldset>

  <fieldset v-if="mode === 'fixed'" class="fieldset">
    <legend class="fieldset-legend">Сцена *</legend>
    <select
      class="select select-sm w-full"
      :disabled="!appId || scenesPending"
      :value="config.sceneId ?? ''"
      @change="emit('update', 'sceneId', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="" disabled>
        {{ !appId ? 'Сначала выберите приложение' : scenesPending ? 'Загрузка…' : 'Выберите сцену' }}
      </option>
      <option v-for="s in scenes" :key="s.id" :value="s.id">
        {{ s.name }} — {{ SCENE_STATUS_LABELS[s.status] ?? s.status }}
      </option>
    </select>
    <p v-if="appId && !scenesPending && scenes.length === 0" class="text-[10px] text-warning mt-0.5">
      Нет сцен. Создайте в разделе «Композитор сцен».
    </p>
  </fieldset>

  <div
    v-if="selectedScene?.promptCompiled"
    class="card bg-base-200/40 border border-base-300"
  >
    <div class="card-body p-3 space-y-1">
      <div class="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold">
        Превью промпта сцены
      </div>
      <p class="text-xs font-mono leading-relaxed line-clamp-4">
        {{ selectedScene.promptCompiled }}
      </p>
      <NuxtLink
        :to="`/scenes/${selectedScene.id}`"
        target="_blank"
        class="text-[11px] link link-primary"
      >
        Открыть композитор →
      </NuxtLink>
    </div>
  </div>

  <div role="alert" class="alert alert-info alert-soft text-xs">
    <Icon name="mingcute:information-line" />
    <span>
      Output: <code>scene</code>, <code>sceneId</code>, <code>compiledPrompt</code>,
      <code>referenceImageUrls</code>, <code>characterIds</code>. Подаётся на Сценарий или Видео.
    </span>
  </div>
</template>
