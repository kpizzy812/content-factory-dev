<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Приложения' })

const { data, pending, refresh } = useAdminApps()
const apps = computed(() => data.value?.data ?? [])

const createModalRef = ref<{ open: () => void; close: () => void } | null>(null)
const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)

const appPendingDelete = ref<AdminApp | null>(null)
const deleteError = ref('')
const deleting = ref(false)

function openModal() {
  createModalRef.value?.open()
}

function onCreated() {
  refresh()
}

function onDeleteRequest(app: AdminApp) {
  deleteError.value = ''
  appPendingDelete.value = app
  deleteModalRef.value?.open(app.name)
}

async function onDeleteConfirmed() {
  const app = appPendingDelete.value
  if (!app) return

  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/admin/apps/${app.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e: unknown) {
    deleteError.value = (e as { data?: { message?: string }; message?: string }).data?.message
      ?? (e as Error).message
      ?? 'Ошибка удаления'
  }
  finally {
    deleting.value = false
    appPendingDelete.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Приложения</li>
      </ul>
    </div>

    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-base-content">Приложения</h1>
      <button class="btn btn-primary btn-sm" @click="openModal">
        <Icon name="mingcute:add-line" />
        Создать приложение
      </button>
    </div>

    <div v-if="deleteError" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ deleteError }}</span>
    </div>

    <!-- Модалка создания -->
    <AdminAppCreateModal ref="createModalRef" @created="onCreated" />

    <!-- Модалка подтверждения удаления -->
    <AdminAppDeleteConfirmModal ref="deleteModalRef" @confirmed="onDeleteConfirmed" />

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <div v-if="apps.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminAppCard
          v-for="app in apps"
          :key="app.id"
          :app="app"
          @delete="onDeleteRequest"
        />
      </div>

      <SharedEmptyState
        v-else
        icon="mingcute:box-line"
        title="Нет приложений"
        description="Создайте первое приложение для начала работы"
      />
    </template>
  </div>
</template>
