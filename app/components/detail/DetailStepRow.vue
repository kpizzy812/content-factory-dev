<script setup lang="ts">
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Шаг генерации. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Действия разведены по стоимости, а не по статусу: бесплатное и локальное —
 * прямо в строке, оплачиваемое — через меню с ценой. Повтор пройденного шага
 * тут штатная операция, а не аварийная.
 *
 * «Попытка 3 из 3» и расхождение оценки с фактом показываются только когда
 * они есть: иначе у каждой строки набирается шум, из-за которого настоящие
 * отклонения перестают замечать.
 */
const props = defineProps<{
  index: number
  label: string
  status: EntityStatus
  durationMs?: number | null
  estimatedCost?: number | null
  actualCost?: number | null
  attempt?: number
  maxAttempts?: number
  model?: string | null
  errorMessage?: string | null
  /** Шаг не дёргает платные модели — повтор можно вынести в строку. */
  cheap?: boolean
  canRetry?: boolean
  canSkip?: boolean
  retryCost?: string
}>()

const emit = defineEmits<{ retry: [], skip: [], logs: [] }>()

const expanded = ref(props.status === 'failed')

const duration = computed(() => {
  if (!props.durationMs) return null
  const s = Math.round(props.durationMs / 1000)
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} м ${s % 60} с`
})

/** Расхождение показываем только заметное — оно объясняет вылет по бюджету. */
const costDrift = computed(() => {
  const { estimatedCost: est, actualCost: act } = props
  if (est == null || act == null || est <= 0) return null
  const diff = (act - est) / est
  return Math.abs(diff) >= 0.25 ? Math.round(diff * 100) : null
})

const attemptsExhausted = computed(() =>
  props.attempt != null && props.maxAttempts != null && props.attempt >= props.maxAttempts,
)

/** Вторая строка: чем считали и сколько это заняло. */
const meta = computed(() => [props.model, duration.value].filter(Boolean) as string[])

const menuItems = computed(() => {
  const items = [{ key: 'logs', label: 'Логи', icon: 'mingcute:file-line' }]
  if (props.canRetry && !props.cheap) {
    items.push({ key: 'retry', label: 'Повторить с этого шага', icon: 'mingcute:refresh-2-line', cost: props.retryCost } as never)
  }
  return items
})
</script>

<template>
  <div
    class="rounded-md border"
    :class="status === 'failed' ? 'border-danger-border bg-danger-bg' : 'border-border bg-card'"
  >
    <!-- Раскладка сеткой, а не одной строкой: иначе на реальных названиях
         подпись шага съедается длительностью, попыткой и суммой. -->
    <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-2.5 px-2.5 py-2">
      <span class="flex shrink-0 items-center gap-2 pt-px">
        <span class="tnum w-4 text-right font-mono text-micro text-subtle">{{ index }}</span>
        <UiStatusBadge :status="status" size="xs" dot icon-only />
      </span>

      <span class="min-w-0">
        <span class="block truncate text-sm">{{ label }}</span>

        <span v-if="meta.length" class="tnum block truncate font-mono text-micro text-subtle">
          {{ meta.join(' · ') }}
        </span>

        <span v-if="attempt && attempt > 1" class="tnum block font-mono text-micro" :class="attemptsExhausted ? 'text-danger' : 'text-warning'">
          попытка {{ attempt }} из {{ maxAttempts }}
        </span>

        <!-- Бесплатное и локальное — прямо в строке -->
        <UiButton v-if="canRetry && cheap" class="mt-1" @click="emit('retry')">
          <Icon name="mingcute:refresh-2-line" />
          Пересобрать
        </UiButton>
      </span>

      <span v-if="actualCost != null" class="tnum shrink-0 text-right font-mono text-sm">
        {{ actualCost.toFixed(2) }} ₽
        <span v-if="costDrift" class="block text-warning">{{ costDrift > 0 ? '+' : '' }}{{ costDrift }}%</span>
      </span>
      <span v-else />

      <span class="flex shrink-0 items-center">
        <UiActionMenu :items="menuItems" @select="$event === 'logs' ? emit('logs') : emit('retry')" />

        <button
          v-if="errorMessage"
          type="button"
          class="cursor-pointer text-subtle hover:text-fg"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <Icon :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'" />
        </button>
      </span>
    </div>

    <div v-if="expanded && errorMessage" class="border-t border-divider px-2.5 py-2">
      <p class="text-sm text-danger">{{ errorMessage }}</p>

      <div v-if="status === 'failed'" class="mt-2 flex flex-wrap gap-1.5">
        <UiButton v-if="canRetry" variant="primary" @click="emit('retry')">
          Повторить с этого шага
          <span v-if="retryCost" class="font-mono text-micro">· {{ retryCost }}</span>
        </UiButton>
        <UiButton v-if="canSkip" @click="emit('skip')">Пропустить и продолжить</UiButton>
      </div>

      <p v-if="attemptsExhausted" class="mt-2 text-sm text-muted">
        Автоповторов больше не будет — следующий запуск только вручную.
      </p>
    </div>
  </div>
</template>
