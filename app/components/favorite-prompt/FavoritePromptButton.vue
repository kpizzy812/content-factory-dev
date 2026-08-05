<script setup lang="ts">
/**
 * Кнопка "звезда" для добавления промта в избранное.
 * На вход получает promptText + optional appId/sourceVideoAssetId.
 * Если по (текущий пользователь, sourceVideoAssetId) уже есть запись — показывает star-fill.
 */
import type { FavoritePrompt } from '~~/shared/types/favorite-prompt'

const props = defineProps<{
  promptText: string
  appId?: number | null
  sourceVideoAssetId?: number | null
}>()

const modalOpen = ref(false)
const lookupResult = ref<FavoritePrompt | null>(null)
const lookupPending = ref(false)

const isFavorite = computed(() => lookupResult.value !== null)

async function lookup() {
  if (!props.sourceVideoAssetId) {
    lookupResult.value = null
    return
  }
  lookupPending.value = true
  try {
    // Прямой запрос к узкой ветке эндпоинта (findFirst по userId+sourceVideoAssetId).
    const res = await $fetch<{ data: FavoritePrompt[] }>(
      '/api/favorite-prompts',
      { query: { sourceVideoAssetId: props.sourceVideoAssetId, perPage: 1 } },
    )
    lookupResult.value = res.data?.[0] ?? null
  } catch {
    lookupResult.value = null
  } finally {
    lookupPending.value = false
  }
}

onMounted(() => {
  void lookup()
})

function onClick() {
  if (isFavorite.value) {
    // Уже в избранном — открываем режим редактирования
    modalOpen.value = true
  } else {
    modalOpen.value = true
  }
}

function onSaved(item: FavoritePrompt) {
  lookupResult.value = item
}
</script>

<template>
  <span class="inline-flex items-center">
    <UiButton
      variant="ghost"
      :loading="lookupPending"
      :disabled="!promptText"
      :class="isFavorite && 'text-warning'"
      :title="isFavorite ? 'Уже в избранном — отредактировать' : 'Добавить в избранное'"
      @click="onClick"
    >
      <Icon v-if="!lookupPending" :name="isFavorite ? 'mingcute:star-fill' : 'mingcute:star-line'" />
      <span class="hidden sm:inline">
        {{ isFavorite ? 'В избранном' : 'В избранное' }}
      </span>
    </UiButton>

    <FavoritePromptModal
      :open="modalOpen"
      :mode="isFavorite ? 'edit' : 'create'"
      :prompt-text="promptText"
      :app-id="appId ?? null"
      :source-video-asset-id="sourceVideoAssetId ?? null"
      :favorite-prompt-id="lookupResult?.id ?? null"
      @update:open="modalOpen = $event"
      @saved="onSaved"
    />
  </span>
</template>
