<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Приложения' })

const { data, pending, error, refresh } = useAdminApps()
const apps = computed<AdminApp[]>(() => data.value?.data ?? [])

const createModalRef = ref<{ open: () => void, close: () => void } | null>(null)
const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)

const appPendingDelete = ref<AdminApp | null>(null)
const deleteError = ref('')

function onDeleteRequest(app: AdminApp) {
  deleteError.value = ''
  appPendingDelete.value = app
  deleteModalRef.value?.open(app.name)
}

async function onDeleteConfirmed() {
  const app = appPendingDelete.value
  if (!app) return
  deleteError.value = ''
  try {
    await $fetch(`/api/admin/apps/${app.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    deleteError.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      ?? (e as Error)?.message
      ?? 'Не удалось удалить приложение'
  }
  finally {
    appPendingDelete.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Приложения</h1>
      <span class="tnum text-sm text-subtle">{{ apps.length }}</span>
      <span class="flex-1" />
      <UiButton variant="primary" @click="createModalRef?.open()">
        <Icon name="mingcute:add-line" />
        Новое приложение
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Приложение связывает тренды, персонажей, аккаунты и циклы. Всё остальное заводится под него.
    </p>

    <p
      v-if="deleteError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ deleteError }}</span>
      <UiButton variant="ghost" @click="deleteError = ''">Закрыть</UiButton>
    </p>

    <UiSkeleton v-if="pending && !apps.length" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить приложения."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!apps.length"
      variant="first"
      title="Приложений нет"
      description="Заведите первое — под него собираются тренды, сценарии и аккаунты."
    >
      <UiButton variant="primary" @click="createModalRef?.open()">Новое приложение</UiButton>
    </UiEmptyState>

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <AdminAppCard
        v-for="app in apps"
        :key="app.id"
        :app="app"
        @delete="onDeleteRequest"
      />
    </div>

    <AdminAppCreateModal ref="createModalRef" @created="refresh()" />
    <AdminAppDeleteConfirmModal ref="deleteModalRef" @confirmed="onDeleteConfirmed" />
  </div>
</template>
