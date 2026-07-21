<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

const props = defineProps<{
  app: AdminApp
}>()

const emit = defineEmits<{
  delete: [app: AdminApp]
}>()

function onDeleteClick(e: Event, app: AdminApp) {
  // карточка обёрнута в NuxtLink — предотвращаем переход
  e.preventDefault()
  e.stopPropagation()
  emit('delete', app)
}

// Модалка референсов — локальный state чтобы не плодить event-ы наверх.
const referenceModalOpen = ref(false)
const referenceUrls = ref<string[]>(props.app.referenceImageUrls ?? [])

watch(() => props.app.referenceImageUrls, (v) => {
  referenceUrls.value = v ?? []
})

function openReferenceModal(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  referenceModalOpen.value = true
}
</script>

<template>
  <NuxtLink :to="`/admin/apps/${app.id}`" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow relative group">
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-circle absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-error hover:text-error-content transition-opacity"
      title="Удалить приложение"
      aria-label="Удалить приложение"
      @click="onDeleteClick($event, app)"
    >
      <Icon name="mingcute:delete-2-line" class="size-4" />
    </button>

    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-3">
        <img
          v-if="app.iconUrl"
          :src="app.iconUrl"
          :alt="app.name"
          class="size-10 rounded-lg shrink-0"
        />
        <div class="min-w-0">
          <h3 class="card-title text-base">
            <Icon v-if="!app.iconUrl" name="mingcute:box-line" class="text-primary" />
            {{ app.name }}
          </h3>
          <p v-if="app.subtitle" class="text-xs text-base-content/50 truncate">
            {{ app.subtitle }}
          </p>
        </div>
      </div>

      <p v-if="app.description" class="text-sm text-base-content/60 line-clamp-2">
        {{ app.description }}
      </p>

      <div class="flex flex-wrap items-center gap-2 mt-1">
        <span
          v-if="app.enrichmentStatus === 'completed'"
          class="badge badge-success badge-sm gap-1"
        >
          <Icon name="mingcute:sparkles-2-line" class="size-3" />
          Обогащено
        </span>
        <span
          v-else-if="app.enrichmentStatus === 'partial'"
          class="badge badge-warning badge-sm"
        >
          Частично
        </span>

        <span v-if="app.categories?.length" class="badge badge-ghost badge-sm">
          {{ app.categories[0] }}
        </span>
      </div>

      <div class="flex items-center justify-between gap-2 mt-2">
        <div v-if="app._count" class="flex gap-4 text-sm text-base-content/60">
          <span class="flex items-center gap-1">
            <Icon name="mingcute:fire-line" class="text-base" />
            {{ app._count.trends }} трендов
          </span>
          <span class="flex items-center gap-1">
            <Icon name="mingcute:user-3-line" class="text-base" />
            {{ app._count.socialAccounts }} аккаунтов
          </span>
          <span class="flex items-center gap-1">
            <Icon name="mingcute:refresh-2-line" class="text-base" />
            {{ app._count.cycles }} циклов
          </span>
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          title="Reference-изображения приложения"
          aria-label="Референсы приложения"
          @click="openReferenceModal"
        >
          <Icon name="mingcute:attachment-line" class="size-4" />
          <span
            v-if="referenceUrls.length > 0"
            class="badge badge-xs badge-primary"
          >{{ referenceUrls.length }}</span>
        </button>
      </div>
    </div>
  </NuxtLink>

  <AdminAppReferenceImagesModal
    v-model:open="referenceModalOpen"
    :app-id="app.id"
    :app-name="app.name"
    :initial-urls="referenceUrls"
    @updated="(urls) => referenceUrls = urls"
  />
</template>
