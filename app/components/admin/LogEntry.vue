<script setup lang="ts">
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
const showDetails = ref(false)

const levelConfig: Record<string, { label: string; badge: string }> = {
  info: { label: 'Инфо', badge: 'badge-info' },
  warn: { label: 'Внимание', badge: 'badge-warning' },
  error: { label: 'Ошибка', badge: 'badge-error' },
}

const moduleLabels: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Загрузка',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
  telegram: 'Telegram',
  webhook: 'Webhook',
  'secret-access': 'Секреты',
  'app-enrichment': 'App enrichment',
  'posting-job': 'Posting',
}

const hasDetails = computed(() => {
  if (!props.log.details) return false
  if (typeof props.log.details === 'object') {
    return Object.keys(props.log.details as Record<string, unknown>).length > 0
  }
  return true
})

const canResolve = computed(
  () => props.log.source === 'agent' && props.log.resolved === false,
)

const isResolved = computed(
  () => props.log.source === 'agent' && props.log.resolved === true,
)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

async function resolve() {
  if (props.log.source !== 'agent') return
  resolving.value = true
  try {
    await $fetch(`/api/admin/logs/${props.log.rawId}/resolve`, { method: 'PUT' })
    emit('resolved', props.log.rawId)
  } finally {
    resolving.value = false
  }
}
</script>

<template>
  <div
    class="rounded-box bg-base-100 p-3 border border-base-200"
    :class="{ 'opacity-60': isResolved }"
  >
    <div class="flex items-start gap-3">
      <span
        :class="[
          'badge badge-sm shrink-0 mt-0.5',
          levelConfig[log.level]?.badge ?? 'badge-ghost',
        ]"
      >
        {{ levelConfig[log.level]?.label ?? log.level }}
      </span>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <!-- Бейдж источника -->
          <span class="badge badge-soft badge-sm gap-1 shrink-0">
            <Icon :name="ADMIN_LOG_SOURCE_ICONS[log.source]" class="text-xs" />
            {{ ADMIN_LOG_SOURCE_LABELS[log.source] }}
          </span>
          <span class="text-xs font-medium text-base-content/60">
            {{ moduleLabels[log.module] ?? log.module }}
          </span>
          <NuxtLink
            v-if="log.ref?.href"
            :to="log.ref.href"
            class="badge badge-xs badge-outline badge-primary"
            @click.stop
          >
            {{ log.ref.label }}
          </NuxtLink>
          <span
            v-else-if="log.ref"
            class="badge badge-xs badge-ghost"
          >
            {{ log.ref.label }}
          </span>
          <span class="text-xs text-base-content/40">{{ formatDate(log.createdAt) }}</span>
        </div>
        <p class="text-sm text-base-content mt-0.5 break-words">{{ log.message }}</p>

        <!-- Кнопка для деталей -->
        <button
          v-if="hasDetails"
          type="button"
          class="btn btn-ghost btn-xs mt-1 gap-1 text-base-content/50"
          @click="showDetails = !showDetails"
        >
          <Icon :name="showDetails ? 'mingcute:up-line' : 'mingcute:down-line'" class="text-xs" />
          {{ showDetails ? 'Скрыть' : 'Детали' }}
        </button>

        <!-- Развёрнутые детали -->
        <div
          v-if="showDetails && hasDetails"
          class="mt-2 p-2 rounded-box bg-base-200 text-xs overflow-x-auto"
        >
          <pre class="whitespace-pre-wrap break-words text-base-content/70">{{ JSON.stringify(log.details, null, 2) }}</pre>
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button
          v-if="canResolve"
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="resolving"
          title="Отметить как решённое"
          @click="resolve"
        >
          <span v-if="resolving" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:check-line" />
        </button>
        <span v-else-if="isResolved" class="badge badge-sm badge-success badge-ghost">
          <Icon name="mingcute:check-line" class="text-xs" />
        </span>
      </div>
    </div>
  </div>
</template>
