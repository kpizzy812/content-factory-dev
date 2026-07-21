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
// Pinia setup-store unwraps computed при доступе через store.x — поэтому
// прямая передача `store.logQuery` ломает reactivity useFetch (приходит
// плоский объект, watcher не срабатывает). Оборачиваем в computed, чтобы
// получить ComputedRef, который useFetch правильно отслеживает.
const logQueryRef = computed(() => store.logQuery)
const { data, pending, refresh } = useAdminLogs(logQueryRef)
const logs = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

const sourceCounts = computed(() => meta.value?.sourceCounts ?? null)

function isSourceActive(s: AdminLogSource): boolean {
  return store.logSources.includes(s)
}

function onResolved() {
  refresh()
}

function onPageUpdate(p: number) {
  store.page = p
}
</script>

<template>
  <div class="space-y-4">
    <!-- Breadcrumbs -->
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Логи</li>
      </ul>
    </div>

    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Логи</h1>
        <p class="text-sm text-base-content/60">
          Унифицированная лента из всех источников: агенты, App enrichment,
          Telegram, секреты, Trendwatcher, webhooks, AI audit, posting.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-1"
        :disabled="pending"
        @click="refresh()"
      >
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </button>
    </div>

    <!-- Сводка по источникам -->
    <div
      v-if="sourceCounts"
      class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2"
    >
      <button
        v-for="src in ADMIN_LOG_SOURCES_ALL"
        :key="src"
        type="button"
        class="card card-border bg-base-100 cursor-pointer hover:border-primary/40 transition-colors"
        :class="{ 'border-primary/60 bg-primary/5': isSourceActive(src) }"
        @click="store.toggleLogSource(src)"
      >
        <div class="card-body p-3 gap-1">
          <div class="flex items-center gap-1.5">
            <Icon :name="ADMIN_LOG_SOURCE_ICONS[src]" class="text-primary text-sm" />
            <span class="text-xs font-semibold truncate">
              {{ ADMIN_LOG_SOURCE_LABELS[src] }}
            </span>
          </div>
          <div class="text-lg font-bold text-base-content">
            {{ sourceCounts[src] ?? 0 }}
          </div>
        </div>
      </button>
    </div>

    <AdminLogFilters />

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <div v-if="logs.length" class="space-y-2">
        <AdminLogEntry
          v-for="log in logs"
          :key="log.id"
          :log="log"
          @resolved="onResolved"
        />
      </div>

      <SharedEmptyState
        v-else
        icon="mingcute:document-line"
        title="Нет логов"
        description="Под текущие фильтры ничего не нашлось. Попробуй сбросить фильтры или выбрать другие источники."
      />

      <SharedPagination
        v-if="meta && meta.totalPages > 1"
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        @update:page="onPageUpdate"
      />
    </template>
  </div>
</template>
