<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

definePageMeta({
  middleware: ['admin-access'],
})

const route = useRoute()
const appId = computed(() => Number(route.params.id))

const { data, pending, error, refresh } = useFetch<{ data: AdminApp }>(
  () => `/api/admin/apps/${appId.value}`,
  { key: `admin-app-${appId.value}` },
)

const app = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => app.value ? `${app.value.name} - Приложение` : 'Приложение'),
})

function onSaved() {
  refresh()
  refreshNuxtData('admin-apps')
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li><NuxtLink to="/admin/apps">Приложения</NuxtLink></li>
        <li v-if="app">{{ app.name }}</li>
      </ul>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>{{ error.message }}</span>
    </div>

    <template v-else-if="app">
      <div class="flex items-center gap-3">
        <img
          v-if="app.iconUrl"
          :src="app.iconUrl"
          :alt="app.name"
          class="size-12 rounded-xl"
        />
        <div>
          <h1 class="text-2xl font-bold text-base-content">
            {{ app.name }}
          </h1>
          <p v-if="app.subtitle" class="text-sm text-base-content/60">
            {{ app.subtitle }}
          </p>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <AdminAppForm :app="app" @saved="onSaved" @cancel="navigateTo('/admin/apps')" />
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base flex items-center gap-2">
            <Icon name="mingcute:attachment-line" class="size-5 text-primary" />
            Reference-изображения
            <span v-if="app.referenceImageUrls?.length" class="badge badge-sm badge-primary">
              {{ app.referenceImageUrls.length }}
            </span>
          </h2>
          <p class="text-sm text-base-content/60 -mt-1 mb-2">
            Передаются в контекст генерации сценариев и видео — используются AI как визуальные эталоны стиля, героев и объектов.
          </p>
          <AdminAppReferenceImagesManager
            :app-id="app.id"
            :initial-urls="app.referenceImageUrls ?? []"
            :enable-global-paste="false"
          />
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base flex items-center gap-2">
            <Icon name="mingcute:share-2-line" class="size-5 text-primary" />
            Аккаунты соцсетей и группы
          </h2>
          <p class="text-sm text-base-content/60 -mt-1 mb-2">
            Подключите аккаунты этого приложения и сгруппируйте их для распределения публикаций по стратегии.
          </p>
          <AdminAppAccountsManager :app-id="app.id" />
        </div>
      </div>
    </template>
  </div>
</template>
