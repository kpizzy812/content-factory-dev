<script setup lang="ts">
import type { Scene } from '~~/shared/types/scene'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Композитор сцен' })

const filters = useSceneFiltersStore()
const router = useRouter()
const createModal = ref<{ open: () => void } | null>(null)

const { data, pending, error, refresh } = useScenes(computed(() => filters.query))
const scenes = computed<Scene[]>(() => data.value?.data ?? [])

const appChosen = computed(() => Boolean(filters.appId))

async function onCreated(payload: { id: string, name: string }) {
  await refresh()
  router.push(`/scenes/${payload.id}`)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Композитор сцен</h1>
      <span v-if="appChosen" class="tnum text-sm text-subtle">{{ scenes.length }}</span>
      <span class="flex-1" />
      <UiButton v-if="appChosen" variant="primary" @click="createModal?.open()">
        <Icon name="mingcute:add-line" />
        Новая сцена
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Сцена собирается из блоков — персонаж, стиль, окружение, действие, скрин. Итоговый промпт
      уходит в конвейер.
    </p>

    <SceneFilters />

    <UiEmptyState
      v-if="!appChosen"
      title="Выберите приложение"
      description="Сцены заводятся под конкретное приложение — сначала выберите его в фильтре."
    />

    <UiSkeleton v-else-if="pending && !scenes.length" variant="cards" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить сцены."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!scenes.length && (filters.search || filters.status)"
      variant="search"
      title="Ничего не найдено"
      description="Под текущие фильтры сцен нет."
    >
      <UiButton @click="filters.reset()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!scenes.length"
      variant="first"
      title="Сцен пока нет"
      description="Создайте сцену и добавьте блоки персонажа, стиля, окружения и действия — промпт соберётся сам."
    />

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <SceneCard v-for="scene in scenes" :key="scene.id" :scene="scene" />
    </div>

    <SceneCreateModal
      v-if="filters.appId"
      ref="createModal"
      :app-id="filters.appId"
      @created="onCreated"
    />
  </div>
</template>
