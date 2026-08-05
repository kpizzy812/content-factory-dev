<script setup lang="ts">
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Персонажи' })

const filters = useCharacterFiltersStore()
const createModal = ref<{ open: () => void } | null>(null)

const { data, pending, error, refresh } = useCharacters(computed(() => filters.query))
const characters = computed<(Character & { referenceImages?: CharacterReferenceImage[] })[]>(
  () => data.value?.data ?? [],
)

// Раздел устроен вокруг приложения: без него запрос вернул бы чужих персонажей.
const appChosen = computed(() => Boolean(filters.appId))
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Персонажи</h1>
      <span v-if="appChosen" class="tnum text-sm text-subtle">{{ characters.length }}</span>
      <span class="flex-1" />
      <UiButton v-if="appChosen" variant="primary" @click="createModal?.open()">
        <Icon name="mingcute:add-line" />
        Добавить персонажа
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Реф-фото и описание героев, которых подставляют в сцены композитора и блоки конвейера.
    </p>

    <CharacterFilters />

    <UiEmptyState
      v-if="!appChosen"
      title="Выберите приложение"
      description="Персонажи заводятся под конкретное приложение — сначала выберите его в фильтре."
    />

    <UiSkeleton v-else-if="pending && !characters.length" variant="cards" :count="8" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить персонажей."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!characters.length && filters.search"
      variant="search"
      title="Ничего не найдено"
      :description="`По запросу «${filters.search}» персонажей нет.`"
    >
      <UiButton @click="filters.reset()">Сбросить поиск</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!characters.length"
      variant="first"
      title="Персонажей пока нет"
      description="Создайте героя и загрузите два-три референса — лицо, фигуру, одежду. После этого его можно ставить в сцены."
    />

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <CharacterCard v-for="character in characters" :key="character.id" :character="character" />
    </div>

    <CharacterCreateModal
      v-if="filters.appId"
      ref="createModal"
      :app-id="filters.appId"
      @created="refresh()"
    />
  </div>
</template>
