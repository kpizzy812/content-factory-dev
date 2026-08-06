<script setup lang="ts">
/**
 * Идентификаторы профиля и счётчики.
 *
 * Идентификаторы нужны для сверки с облаком и для поддержки, поэтому у каждого
 * есть копирование; ошибка последней синхронизации показывается здесь же —
 * она объясняет расхождение локального и облачного состояния.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const toast = useToast()

const ids = computed(() => [
  { key: 'id', label: 'Локальный', value: props.profile.id },
  { key: 'indigoId', label: 'В облаке', value: props.profile.indigoId },
  { key: 'folderId', label: 'Папка', value: props.profile.indigoFolderId },
].filter(row => Boolean(row.value)) as Array<{ key: string, label: string, value: string }>)

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} скопирован`)
  }
  catch {
    // Буфер обмена недоступен без защищённого соединения — молча, кнопка не главная.
  }
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Профиль</h2>

    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span>Сессий <span class="tnum font-mono text-fg">{{ profile.totalSessions }}</span></span>
      <span>Аккаунтов <span class="tnum font-mono text-fg">{{ profile.accounts.length }}</span></span>
      <span>Тегов <span class="tnum font-mono text-fg">{{ profile.tags.length }}</span></span>
    </div>

    <div class="flex flex-col">
      <div
        v-for="row in ids"
        :key="row.key"
        class="flex items-center gap-2 border-b border-divider py-1.5 last:border-b-0"
      >
        <span class="w-24 shrink-0 text-sm text-muted">{{ row.label }}</span>
        <code class="min-w-0 flex-1 truncate font-mono text-sm">{{ row.value }}</code>
        <UiButton
          icon-only
          variant="ghost"
          :title="`Скопировать: ${row.label}`"
          :aria-label="`Скопировать идентификатор: ${row.label}`"
          @click="copy(row.value, row.label)"
        >
          <Icon name="mingcute:copy-2-line" />
        </UiButton>
      </div>
    </div>

    <p
      v-if="profile.lastSyncError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ profile.lastSyncError }}</span>
    </p>
  </section>
</template>
