<script setup lang="ts">
import {
  ADMIN_LOG_SOURCE_ICONS,
  ADMIN_LOG_SOURCE_LABELS,
  ADMIN_LOG_SOURCES_ALL,
  type AdminLogSource,
} from '~~/shared/types/admin-log'

definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Логи' })

const store = useAdminFiltersStore()
// Pinia разворачивает computed при доступе через store.x, и useFetch получил бы
// плоский объект без реактивности. Оборачиваем обратно в computed.
const logQueryRef = computed(() => store.logQuery)
const { data, pending, error, refresh } = useAdminLogs(logQueryRef)
const logs = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

const sourceCounts = computed(() => meta.value?.sourceCounts ?? null)

function isSourceActive(s: AdminLogSource): boolean {
  return store.logSources.includes(s)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Логи</h1>
      <span v-if="meta" class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton variant="ghost" :disabled="pending" @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Одна лента из всех источников: агенты, обогащение приложений, Telegram, секреты,
      трендвотчер, вебхуки, аудит AI и постинг.
    </p>

    <div v-if="sourceCounts" class="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <button
        v-for="src in ADMIN_LOG_SOURCES_ALL"
        :key="src"
        type="button"
        class="flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-left transition-colors duration-(--duration-fast)"
        :class="isSourceActive(src)
          ? 'border-accent-border bg-accent-bg'
          : 'border-border bg-card hover:border-subtle'"
        :aria-pressed="isSourceActive(src)"
        @click="store.toggleLogSource(src)"
      >
        <span class="flex items-center gap-1.5 text-micro text-muted">
          <Icon :name="ADMIN_LOG_SOURCE_ICONS[src]" class="shrink-0" />
          <span class="truncate">{{ ADMIN_LOG_SOURCE_LABELS[src] }}</span>
        </span>
        <span class="tnum font-mono text-base">{{ sourceCounts[src] ?? 0 }}</span>
      </button>
    </div>

    <AdminLogFilters />

    <UiSkeleton v-if="pending && !logs.length" variant="details" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить логи."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!logs.length"
      variant="search"
      title="Записей нет"
      description="Под текущие фильтры ничего не нашлось — снимите фильтры или выберите другие источники."
    >
      <UiButton @click="store.resetLogFilters()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <template v-else>
      <!--
        Виртуализация не нужна: endpoint отдаёт страницами по 30 записей, и в
        DOM никогда не бывает больше одной страницы.
      -->
      <div class="rounded-lg border border-border bg-panel p-1.5">
        <AdminLogEntry
          v-for="log in logs"
          :key="log.id"
          :log="log"
          @resolved="refresh()"
        />
      </div>

      <ListPagination
        v-if="meta"
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        :per-page="store.perPage"
        @update:page="(p) => store.page = p"
        @update:per-page="(v) => { store.perPage = v; store.resetPage() }"
      />
    </template>
  </div>
</template>
