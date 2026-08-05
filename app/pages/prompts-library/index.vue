<script setup lang="ts">
import type { FavoritePrompt } from '~~/shared/types/favorite-prompt'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Лучшие промты' })

const filtersStore = useFavoritePromptFiltersStore()

const query = computed(() => filtersStore.query)

const { data, pending, error, refresh } = useFavoritePrompts(query)

const items = computed<FavoritePrompt[]>(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

// Edit modal
const editOpen = ref(false)
const editId = ref<number | null>(null)

function onEdit(id: number) {
  editId.value = id
  editOpen.value = true
}

async function onSaved(_item: FavoritePrompt) {
  editOpen.value = false
  await refresh()
}

// Delete
const deletingId = ref<number | null>(null)
const deleteConfirmId = ref<number | null>(null)
const deleteError = ref<string | null>(null)
const confirmModalRef = ref<{ open: () => void; close: () => void; setBusy: (v: boolean) => void } | null>(null)

function onDelete(id: number) {
  if (deletingId.value !== null) return
  deleteError.value = null
  deleteConfirmId.value = id
  confirmModalRef.value?.open()
}

async function confirmDelete() {
  const id = deleteConfirmId.value
  if (id === null || deletingId.value !== null) return
  deleteError.value = null
  try {
    deletingId.value = id
    confirmModalRef.value?.setBusy(true)
    const { removeFavoritePrompt } = useFavoritePromptActions()
    await removeFavoritePrompt(id)
    deleteConfirmId.value = null
    confirmModalRef.value?.close()
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    deleteError.value = err?.data?.message || err?.message || 'Не удалось удалить'
  } finally {
    deletingId.value = null
    confirmModalRef.value?.setBusy(false)
  }
}

function cancelDelete() {
  if (deletingId.value !== null) return
  deleteConfirmId.value = null
}

function onPageUpdate(p: number) {
  filtersStore.setPage(p)
}

// Reanalyzed: refresh списка чтобы подтянуть свежий aiPatternAnalysis.
async function onReanalyzed(_id: number) {
  await refresh()
}

// Polling: если на странице есть карточки в pending-статусе (анализ ещё в фоне),
// раз в 5с обновляем список. Auto-stop когда pending-карточек больше нет.
const hasPending = computed(() => items.value.some(item =>
  !item.aiAnalyzedAt && item.aiAnalysisAttempts < 3,
))

let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling() {
  if (pollTimer || !hasPending.value) return
  pollTimer = setInterval(() => {
    if (!hasPending.value) {
      stopPolling()
      return
    }
    refresh()
  }, 5000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(hasPending, (val) => {
  if (val) startPolling()
  else stopPolling()
}, { immediate: true })

onUnmounted(stopPolling)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Лучшие промты</h1>
      <span class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <FavoritePromptFilters />

    <p v-if="deleteError" class="rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
      {{ deleteError }}
    </p>

    <UiSkeleton v-if="pending && !items.length" variant="cards" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить библиотеку."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!items.length"
      variant="first"
      title="Библиотека пуста"
      description="Отметьте промт звездой на вкладке «Кадры» готового ролика — он появится здесь."
    />

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FavoritePromptCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          @edit="onEdit"
          @delete="onDelete"
          @reanalyzed="onReanalyzed"
        />
      </div>

      <ListPagination
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        :per-page="meta.perPage"
        @update:page="onPageUpdate"
        @update:per-page="filtersStore.perPage = $event; filtersStore.resetPage()"
      />
    </template>

    <FavoritePromptModal
      :open="editOpen"
      mode="edit"
      :favorite-prompt-id="editId"
      @update:open="editOpen = $event"
      @saved="onSaved"
    />

    <!-- Подтверждение удаления -->
    <SharedConfirmModal
      ref="confirmModalRef"
      title="Удалить избранный промт?"
      message="Это действие необратимо. Промт будет удалён из библиотеки навсегда."
      confirm-label="Удалить"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
