<script setup lang="ts">
/**
 * Карточка интеграции. Источник: design-preview/catalog/08-settings-admin.dc.html
 *
 * Секретов карточка не показывает и не правит: ключ MarketingCamp живёт в
 * окружении, а не в базе. Здесь только состояние связи и её проверка.
 */
const { data, pending, refresh } = useIntegrationStatus()

const isRefreshing = ref(false)

async function checkConnection() {
  isRefreshing.value = true
  try {
    await refresh()
  }
  finally {
    isRefreshing.value = false
  }
}

const status = computed(() => data.value?.data ?? null)

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-2.5 border-b border-divider px-3.5 py-2.5">
      <span class="flex size-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-card">
        <Icon name="mingcute:link-line" class="text-muted" />
      </span>
      <span class="min-w-0">
        <span class="block font-medium">MarketingCamp</span>
        <span class="block text-micro text-subtle">учётные записи и права</span>
      </span>

      <span
        v-if="status"
        class="inline-flex h-5 items-center gap-1.5 rounded-sm border px-[7px] text-sm"
        :class="status.connected
          ? 'border-success-border bg-success-bg text-success'
          : 'border-danger-border bg-danger-bg text-danger'"
      >
        <span class="size-1.5 rounded-full bg-current" />
        {{ status.connected ? 'подключено' : 'нет связи' }}
      </span>

      <span class="flex-1" />

      <ClientOnly>
        <span v-if="status" class="tnum font-mono text-micro text-subtle">
          проверено {{ formatTime(status.lastChecked) }}
        </span>
      </ClientOnly>

      <UiButton :loading="isRefreshing || pending" @click="checkConnection">
        Проверить
      </UiButton>
    </div>

    <div class="px-3.5 py-3">
      <UiSkeleton v-if="pending && !status" variant="details" :count="2" />

      <p
        v-else-if="status?.error"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span class="min-w-0 flex-1">{{ status.error }}</span>
      </p>

      <p v-else class="text-sm text-muted">
        Логин и права приходят из MarketingCamp при входе. Отдельного ключа
        здесь нет — он задаётся в окружении приложения.
      </p>
    </div>
  </section>
</template>
