<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

definePageMeta({ middleware: ['admin-access'] })

const route = useRoute()
const appId = computed(() => Number(route.params.id))

const { data, pending, error, refresh } = useFetch<{ data: AdminApp }>(
  () => `/api/admin/apps/${appId.value}`,
  { key: `admin-app-${appId.value}` },
)

const app = computed(() => data.value?.data ?? null)

useHead({ title: computed(() => `${app.value?.name ?? 'Приложение'} — приложение`) })

function onSaved() {
  refresh()
  refreshNuxtData('admin-apps')
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !app" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить приложение"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="app">
      <DetailHeader
        :title="app.name"
        :code="`app_${app.id}`"
        back-to="/admin/apps"
        back-label="К приложениям"
      >
        <template #badges>
          <img
            v-if="app.iconUrl"
            :src="app.iconUrl"
            :alt="app.name"
            class="size-6 shrink-0 rounded-md border border-border"
          >
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span v-if="app.subtitle" class="min-w-0 truncate">{{ app.subtitle }}</span>
        <span v-if="app.geo" class="flex items-center gap-1.5">
          Гео
          <span class="font-mono text-fg">{{ app.geo }}</span>
        </span>
        <span v-if="app.language" class="flex items-center gap-1.5">
          Язык
          <span class="font-mono text-fg">{{ app.language }}</span>
        </span>
      </div>

      <div class="flex flex-col gap-3">
        <section class="rounded-lg border border-border bg-panel p-3.5">
          <AdminAppForm :app="app" @saved="onSaved" @cancel="navigateTo('/admin/apps')" />
        </section>

        <section class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2">
            <h2 class="flex items-center gap-2 text-micro tracking-[.06em] text-subtle uppercase">
              <Icon name="mingcute:attachment-line" />
              Референс-изображения
              <span v-if="app.referenceImageUrls?.length" class="tnum font-mono">
                {{ app.referenceImageUrls.length }}
              </span>
            </h2>
            <p class="mt-1 text-sm text-muted">
              Уходят в контекст генерации сценариев и роликов как эталон стиля, героев и объектов.
            </p>
          </div>

          <AdminAppReferenceImagesManager
            :app-id="app.id"
            :initial-urls="app.referenceImageUrls ?? []"
            :enable-global-paste="false"
          />
        </section>

        <section class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2">
            <h2 class="flex items-center gap-2 text-micro tracking-[.06em] text-subtle uppercase">
              <Icon name="mingcute:scissors-line" />
              Монтажный профиль
            </h2>
            <p class="mt-1 text-sm text-muted">
              Правила монтажа для всех роликов приложения: доля перебивок, смена кадра, картинка в углу
              и два денежных потолка на один ролик. На отдельном ролике их можно переопределить.
            </p>
          </div>

          <AdminAppEditProfiles :app-id="app.id" />
        </section>

        <section class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2">
            <h2 class="flex items-center gap-2 text-micro tracking-[.06em] text-subtle uppercase">
              <Icon name="mingcute:pic-line" />
              Библиотека фонов
            </h2>
            <p class="mt-1 text-sm text-muted">
              Записи экрана, съёмка и картинки, которые монтаж берёт вместо платной генерации фона.
              Дубли по файлу отсекаются, похожие по первому кадру — помечаются.
            </p>
          </div>

          <AdminAppBackgroundLibrary :app-id="app.id" />
        </section>

        <section class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2">
            <h2 class="flex items-center gap-2 text-micro tracking-[.06em] text-subtle uppercase">
              <Icon name="mingcute:share-2-line" />
              Аккаунты и группы
            </h2>
            <p class="mt-1 text-sm text-muted">
              Аккаунты этого приложения и группы, по которым расходятся публикации.
            </p>
          </div>

          <AdminAppAccountsManager :app-id="app.id" />
        </section>
      </div>
    </template>
  </div>
</template>
