<script setup lang="ts">
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Персонажи' })

const filtersStore = useCharacterFiltersStore()
const createModal = ref<{ open: () => void } | null>(null)

const { data, pending, error, refresh } = useCharacters(computed(() => filtersStore.query))
const characters = computed<(Character & { referenceImages?: CharacterReferenceImage[] })[]>(() => data.value?.data ?? [])

function onCreated() {
  refresh()
}

const canShow = computed(() => Boolean(filtersStore.appId))
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Персонажи</h1>
        <p class="text-sm text-base-content/60 mt-1">
          Реф-фото и описание персонажей, которых будете вставлять в сцены композитора и блоки конвейера.
        </p>
      </div>
      <button
        v-if="canShow && filtersStore.appId"
        type="button"
        class="btn btn-primary btn-sm"
        @click="createModal?.open()"
      >
        <Icon name="mingcute:add-line" class="size-4" />
        Добавить персонажа
      </button>
    </div>

    <CharacterFilters />

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
      v-else-if="characters.length === 0"
      icon="mingcute:user-3-line"
      title="Персонажей пока нет"
      description="Создайте первого героя, загрузите 2–3 фото-референса (лицо/тело/одежда) — и можно собирать сцены."
    />

    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      <CharacterCard
        v-for="character in characters"
        :key="character.id"
        :character="character"
      />
    </div>

    <CharacterCreateModal
      v-if="filtersStore.appId"
      ref="createModal"
      :app-id="filtersStore.appId"
      @created="onCreated"
    />
  </div>
</template>
