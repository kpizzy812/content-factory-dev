<script setup lang="ts">
import { platformMeta } from '~/components/ui/platform-meta'
import { readinessMarks } from './AccountReadinessMap'
import { POSTING_METHOD_LABELS } from './AccountStatusMap'
import type { AccountRow } from './account-row'

/**
 * Содержимое боковой панели аккаунта. Источник: раздел «Боковая панель аккаунта»
 * макета 06.
 *
 * Метрик, последних публикаций и истории проверок из макета здесь нет: снимки
 * метрик живут в своей вкладке (`/api/accounts/:id/metrics`), а сводного
 * endpoint под панель не существует. Показываем то, что уже приехало со списком.
 */
const props = defineProps<{ account: AccountRow }>()

const marks = computed(() => readinessMarks(props.account))

const TONE = {
  ok: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger',
  none: 'text-subtle',
} as const

const ICON = {
  ok: 'mingcute:check-line',
  warn: 'mingcute:alert-line',
  fail: 'mingcute:close-line',
  none: 'mingcute:subtract-line',
} as const

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}

const facts = computed(() => [
  { label: 'Платформа', value: platformMeta(props.account.platform).label, mono: false },
  { label: 'Метод постинга', value: POSTING_METHOD_LABELS[props.account.postingMethod ?? 'api'] ?? props.account.postingMethod, mono: false },
  { label: 'Приложение', value: props.account.app?.name ?? null, mono: false },
  { label: 'ID платформы', value: props.account.platformUserId },
  { label: 'Публикаций', value: props.account._count?.uploads ?? 0 },
  { label: 'Групп', value: props.account._count?.groups ?? 0 },
  { label: 'Последняя публикация', value: fmtDate(props.account.lastPostedAt) },
  { label: 'Токен до', value: fmtDate(props.account.expiresAt) },
  { label: 'Подключён', value: fmtDate(props.account.createdAt) },
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <section>
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Готовность</h3>
      <div class="flex flex-col gap-1.5">
        <div v-for="mark in marks" :key="mark.code" class="flex items-start gap-2 text-sm">
          <Icon :name="ICON[mark.tone]" class="mt-0.5 shrink-0" :class="TONE[mark.tone]" />
          <span class="w-28 shrink-0">{{ mark.label }}</span>
          <span class="min-w-0 flex-1 text-muted">{{ mark.detail }}</span>
        </div>
      </div>
    </section>

    <section
      v-if="account.postingMethod === 'browser_automation'"
      class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span>
        Аккаунт публикует через автоматизацию устройства — это унаследованный контур.
        Прокси, устройство и прогрев доступны только при включённом
        <span class="font-mono">LEGACY_DEVICE_AUTOMATION_ENABLED</span>.
      </span>
    </section>

    <section>
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Свойства</h3>
      <UiKeyValue :items="facts" label-width="150px" />
    </section>

    <section>
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Доступы</h3>
      <p class="text-sm text-muted">
        {{ account.hasLoginCredentials
          ? 'Логин и пароль сохранены в зашифрованном виде — их показывает отдельная проверка с записью в журнал.'
          : 'Логин и пароль не заданы. Для постинга через официальный API они и не нужны.' }}
      </p>
    </section>
  </div>
</template>
