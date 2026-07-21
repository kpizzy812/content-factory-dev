<script setup lang="ts">
import type { Scene } from '~~/shared/types/scene'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Композитор сцен' })

const filtersStore = useSceneFiltersStore()
const router = useRouter()
const createModal = ref<{ open: () => void } | null>(null)

const { data, pending, error, refresh } = useScenes(computed(() => filtersStore.query))
const scenes = computed<Scene[]>(() => data.value?.data ?? [])

async function onCreated(payload: { id: string; name: string }) {
  await refresh()
  router.push(`/scenes/${payload.id}`)
}

const canShow = computed(() => Boolean(filtersStore.appId))
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Композитор сцен</h1>
        <p class="text-sm text-base-content/60 mt-1">
          Собирайте сцены из блоков (Персонаж / Стиль / Окружение / Действие / Скрин). Финальный промпт уходит в pipeline.
        </p>
      </div>
      <button
        v-if="canShow && filtersStore.appId"
        type="button"
        class="btn btn-primary btn-sm"
        @click="createModal?.open()"
      >
        <Icon name="mingcute:add-line" class="size-4" />
        Новая сцена
      </button>
    </div>

    <SceneFilters />

    <div v-if="!canShow" class="alert alert-info alert-soft">
      <Icon name="mingcute:information-line" />
      <span>Сначала выберите приложение.</span>
    </div>

    <div v-else-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка: {{ error.message }}</span>
    </div>

    <SharedEmptyState
      v-else-if="scenes.length === 0"
      icon="mingcute:layers-line"
      title="Сцен пока нет"
      description="Создайте первую сцену. Внутри добавьте блоки персонажа, стиля, окружения и действия — composer соберёт промпт автоматически."
    />

    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <SceneCard v-for="scene in scenes" :key="scene.id" :scene="scene" />
    </div>

    <SceneCreateModal
      v-if="filtersStore.appId"
      ref="createModal"
      :app-id="filtersStore.appId"
      @created="onCreated"
    />
  </div>
</template>
