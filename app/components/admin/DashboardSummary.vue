<script setup lang="ts">
/**
 * Состояние завода одной строкой. Источник: design-preview/catalog/08-settings-admin.dc.html
 *
 * Три прежние карточки — статус, ролики и алерт об ошибках — схлопнуты в одну
 * панель: по отдельности каждая занимала строку экрана ради одного числа.
 */
const props = defineProps<{
  status: 'working' | 'idle' | 'error'
  videosToday: number
  videosWeek: number
  unresolvedErrors: number
}>()

const STATUS = {
  working: { label: 'Завод работает', tone: 'text-success', dot: 'bg-success', live: true },
  idle: { label: 'Завод стоит', tone: 'text-warning', dot: 'bg-warning', live: false },
  error: { label: 'Ошибка', tone: 'text-danger', dot: 'bg-danger', live: false },
} as const

const meta = computed(() => STATUS[props.status] ?? STATUS.idle)
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-3.5 py-3">
      <span class="flex items-center gap-2.5">
        <span
          class="size-2.5 rounded-full"
          :class="[meta.dot, meta.live && 'motion-safe:animate-pulse']"
        />
        <span>
          <span class="block text-sm text-muted">Состояние</span>
          <span class="block text-lg font-semibold" :class="meta.tone">{{ meta.label }}</span>
        </span>
      </span>

      <span class="h-8 w-px bg-divider" />

      <span>
        <span class="block text-sm text-muted">Роликов за сутки</span>
        <span class="tnum block font-mono text-2xl font-semibold">{{ videosToday }}</span>
      </span>

      <span>
        <span class="block text-sm text-muted">За неделю</span>
        <span class="tnum block font-mono text-2xl font-semibold text-muted">{{ videosWeek }}</span>
      </span>

      <span class="flex-1" />

      <NuxtLink
        v-if="unresolvedErrors > 0"
        to="/admin/logs?level=error&resolved=false"
        class="inline-flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-sm text-danger no-underline hover:bg-danger hover:text-inverse"
      >
        <Icon name="mingcute:alert-line" />
        <span class="tnum">{{ unresolvedErrors }} неразобранных ошибок</span>
      </NuxtLink>
      <span v-else class="inline-flex items-center gap-2 text-sm text-success">
        <Icon name="mingcute:check-circle-line" />
        Неразобранных ошибок нет
      </span>
    </div>
  </section>
</template>
