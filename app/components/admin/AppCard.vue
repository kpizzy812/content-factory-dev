<script setup lang="ts">
/**
 * Карточка приложения в списке администратора.
 *
 * Референсы открываются прямо отсюда: их прикладывают пачкой сразу после
 * заведения приложения, и ради этого заходить внутрь незачем.
 */
import type { AdminApp } from '~~/shared/types/app'

const props = defineProps<{
  app: AdminApp
}>()

const emit = defineEmits<{
  delete: [app: AdminApp]
}>()

const referenceModalOpen = ref(false)
const referenceUrls = ref<string[]>(props.app.referenceImageUrls ?? [])

watch(() => props.app.referenceImageUrls, (v) => {
  referenceUrls.value = v ?? []
})

const enrichment = computed(() => {
  if (props.app.enrichmentStatus === 'completed') {
    return { label: 'Обогащено', tone: 'border-success-border bg-success-bg text-success' }
  }
  if (props.app.enrichmentStatus === 'partial') {
    return { label: 'Обогащено частично', tone: 'border-warning-border bg-warning-bg text-warning' }
  }
  return null
})
</script>

<template>
  <article class="relative flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
    <div class="flex items-start gap-2.5">
      <img
        v-if="app.iconUrl"
        :src="app.iconUrl"
        :alt="app.name"
        class="size-10 shrink-0 rounded-md border border-divider object-cover"
      >
      <span
        v-else
        class="flex size-10 shrink-0 items-center justify-center rounded-md border border-divider bg-panel text-subtle"
      >
        <Icon name="mingcute:box-line" />
      </span>

      <div class="min-w-0 flex-1">
        <NuxtLink :to="`/admin/apps/${app.id}`" class="block truncate font-medium hover:underline">
          {{ app.name }}
        </NuxtLink>
        <p v-if="app.subtitle" class="truncate text-micro text-subtle">{{ app.subtitle }}</p>
      </div>

      <UiActionMenu
        :items="[{ key: 'delete', label: 'Удалить приложение', icon: 'mingcute:delete-2-line', danger: true }]"
        @select="emit('delete', app)"
      />
    </div>

    <p v-if="app.description" class="line-clamp-2 text-sm text-muted">{{ app.description }}</p>

    <div class="flex flex-wrap items-center gap-1.5">
      <span v-if="enrichment" class="rounded-sm border px-1.5 py-0.5 text-micro" :class="enrichment.tone">
        {{ enrichment.label }}
      </span>
      <span
        v-if="app.categories?.length"
        class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle"
      >
        {{ app.categories[0] }}
      </span>
    </div>

    <div v-if="app._count" class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span>Трендов <span class="tnum font-mono text-fg">{{ app._count.trends }}</span></span>
      <span>Аккаунтов <span class="tnum font-mono text-fg">{{ app._count.socialAccounts }}</span></span>
      <span>Циклов <span class="tnum font-mono text-fg">{{ app._count.cycles }}</span></span>
    </div>

    <div class="mt-auto flex items-center gap-1.5 pt-1">
      <UiButton variant="ghost" title="Референс-изображения приложения" @click="referenceModalOpen = true">
        <Icon name="mingcute:attachment-line" />
        Референсы
        <span v-if="referenceUrls.length" class="tnum font-mono text-micro text-subtle">
          {{ referenceUrls.length }}
        </span>
      </UiButton>
      <span class="flex-1" />
      <NuxtLink :to="`/admin/apps/${app.id}`">
        <UiButton variant="ghost">Открыть</UiButton>
      </NuxtLink>
    </div>

    <AdminAppReferenceImagesModal
      v-model:open="referenceModalOpen"
      :app-id="app.id"
      :app-name="app.name"
      :initial-urls="referenceUrls"
      @updated="(urls) => referenceUrls = urls"
    />
  </article>
</template>
