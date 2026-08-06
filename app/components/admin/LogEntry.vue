<script setup lang="ts">
/**
 * Строка объединённой ленты журналов.
 *
 * Подача как у `UiLogRow` — моноширинное время, уровень отдельной колонкой,
 * сообщение в одну строку с раскрытием по клику. Своя реализация нужна из-за
 * того, чего у общей строки нет: источник, ссылка на сущность и отметка
 * «разобрано» у записей агента.
 */
import {
  ADMIN_LOG_SOURCE_ICONS,
  ADMIN_LOG_SOURCE_LABELS,
  type AdminLogEntry,
} from '~~/shared/types/admin-log'

const props = defineProps<{
  log: AdminLogEntry
}>()

const emit = defineEmits<{
  resolved: [id: number | string]
}>()

const resolving = ref(false)
const expanded = ref(false)

const LEVEL_TONE: Record<string, string> = {
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-danger',
}

const LEVEL_LABELS: Record<string, string> = {
  info: 'инфо',
  warn: 'важно',
  error: 'ошибка',
}

const moduleLabels: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Публикации',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
  telegram: 'Telegram',
  webhook: 'Вебхуки',
  'secret-access': 'Секреты',
  'app-enrichment': 'Обогащение приложений',
  'posting-job': 'Постинг',
}

const hasDetails = computed(() => {
  if (!props.log.details) return false
  if (typeof props.log.details === 'object') {
    return Object.keys(props.log.details as Record<string, unknown>).length > 0
  }
  return true
})

const canResolve = computed(() => props.log.source === 'agent' && props.log.resolved === false)
const isResolved = computed(() => props.log.source === 'agent' && props.log.resolved === true)

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

async function resolve() {
  if (props.log.source !== 'agent') return
  resolving.value = true
  try {
    await $fetch(`/api/admin/logs/${props.log.rawId}/resolve`, { method: 'PUT' })
    emit('resolved', props.log.rawId)
  }
  finally {
    resolving.value = false
  }
}
</script>

<template>
  <div
    class="rounded-sm border-b border-divider last:border-b-0"
    :class="[
      log.level === 'error' && 'border border-danger-border bg-danger-bg',
      isResolved && 'opacity-60',
    ]"
  >
    <div class="flex items-start gap-2.5 px-1.5 py-1.5">
      <span class="tnum shrink-0 font-mono text-micro text-subtle">{{ formatTime(log.createdAt) }}</span>
      <span
        class="w-14 shrink-0 font-mono text-micro uppercase"
        :class="LEVEL_TONE[log.level] ?? 'text-subtle'"
      >
        {{ LEVEL_LABELS[log.level] ?? log.level }}
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5 text-micro text-subtle">
          <span class="inline-flex items-center gap-1 rounded-sm border border-divider px-1.5 text-muted">
            <Icon :name="ADMIN_LOG_SOURCE_ICONS[log.source]" />
            {{ ADMIN_LOG_SOURCE_LABELS[log.source] }}
          </span>
          <span>{{ moduleLabels[log.module] ?? log.module }}</span>
          <NuxtLink
            v-if="log.ref?.href"
            :to="log.ref.href"
            class="rounded-sm border border-accent-border px-1.5 text-accent hover:underline"
            @click.stop
          >
            {{ log.ref.label }}
          </NuxtLink>
          <span v-else-if="log.ref" class="rounded-sm border border-divider px-1.5">{{ log.ref.label }}</span>
        </div>

        <p
          class="mt-0.5 text-sm break-words"
          :class="expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'"
        >
          {{ log.message }}
        </p>

        <button
          v-if="hasDetails"
          type="button"
          class="mt-1 flex cursor-pointer items-center gap-1 text-micro text-subtle hover:text-fg"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <Icon
            name="mingcute:right-line"
            class="transition-transform duration-(--duration-fast)"
            :class="expanded && 'rotate-90'"
          />
          {{ expanded ? 'Свернуть' : 'Подробности' }}
        </button>

        <pre
          v-if="expanded && hasDetails"
          class="mt-1.5 overflow-x-auto rounded-sm bg-surface p-2 font-mono text-[11px] break-words whitespace-pre-wrap text-muted"
        >{{ JSON.stringify(log.details, null, 2) }}</pre>
      </div>

      <UiButton
        v-if="canResolve"
        icon-only
        variant="ghost"
        :loading="resolving"
        title="Отметить как разобранное"
        aria-label="Отметить как разобранное"
        @click="resolve"
      >
        <Icon v-if="!resolving" name="mingcute:check-line" />
      </UiButton>
      <span
        v-else-if="isResolved"
        class="inline-flex shrink-0 items-center gap-1 rounded-sm border border-success-border bg-success-bg px-1.5 text-micro text-success"
        title="Разобрано"
      >
        <Icon name="mingcute:check-line" />
      </span>
    </div>
  </div>
</template>
