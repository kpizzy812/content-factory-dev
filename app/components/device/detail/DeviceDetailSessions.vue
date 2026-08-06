<script setup lang="ts">
/**
 * Сессии профиля.
 *
 * История завершённых сессий не хранится, поэтому показываем только счётчик и
 * последнюю пару «начало — конец»: врать про журнал, которого нет, нельзя.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const toast = useToast()

function formatDate(iso: string | null): string {
  if (!iso) return 'никогда'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const durationLabel = computed(() => {
  if (!props.profile.lastSessionStartedAt || !props.profile.lastSessionEndedAt) return null
  const start = new Date(props.profile.lastSessionStartedAt).getTime()
  const end = new Date(props.profile.lastSessionEndedAt).getTime()
  const diffMin = Math.max(0, Math.round((end - start) / 60_000))
  if (diffMin < 60) return `${diffMin} мин`
  return `${Math.floor(diffMin / 60)} ч ${diffMin % 60} мин`
})

const webdriverUrl = computed(() =>
  props.profile.lastSessionPort ? `http://127.0.0.1:${props.profile.lastSessionPort}` : null)

async function copyWebdriver() {
  if (!webdriverUrl.value) return
  try {
    await navigator.clipboard.writeText(webdriverUrl.value)
    toast.success('Адрес WebDriver скопирован')
  }
  catch {
    // Буфер обмена недоступен без защищённого соединения.
  }
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Сессии</h2>

    <UiKeyValue
      :items="[
        { label: 'Всего', value: profile.totalSessions },
        { label: 'Последний старт', value: formatDate(profile.lastSessionStartedAt) },
        {
          label: 'Завершилась',
          value: durationLabel
            ? `${formatDate(profile.lastSessionEndedAt)} · ${durationLabel}`
            : formatDate(profile.lastSessionEndedAt),
        },
      ]"
      label-width="140px"
    />

    <div
      v-if="profile.sessionState === 'running' && webdriverUrl"
      role="status"
      class="flex flex-wrap items-center gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
    >
      <Icon name="mingcute:play-circle-line" class="shrink-0" />
      <span class="min-w-0 flex-1">
        WebDriver слушает порт {{ profile.lastSessionPort }} —
        <code class="font-mono">{{ webdriverUrl }}</code>
      </span>
      <UiButton variant="ghost" @click="copyWebdriver">
        <Icon name="mingcute:copy-2-line" />
        Копировать
      </UiButton>
    </div>

    <p
      v-else-if="profile.sessionState === 'running'"
      role="status"
      class="flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
    >
      <Icon name="mingcute:play-circle-line" class="mt-0.5 shrink-0" />
      <span>
        Устройство запущено без WebDriver. Управляйте через интерфейс провайдера или включите
        автоматизацию перед следующим запуском, чтобы получить порт.
      </span>
    </p>

    <p v-else class="text-sm text-subtle">
      Профиль не запущен. Журнал завершённых сессий не ведётся.
    </p>
  </section>
</template>
