<script setup lang="ts">
/**
 * Прогресс запуска профиля устройства.
 *
 * Шагов два или три: «Запуск» и «Готово» всегда, «Загрузка ядра» появляется,
 * когда устройство впервые сообщило о загрузке, и остаётся видимым после —
 * иначе оператор не поймёт, почему запуск занял пять минут.
 *
 * Шаг ожидания подписывается по коду: блокировка профиля снимается секунды,
 * ядро качается минуты, и путать их нельзя.
 */
import type { StartFlowState } from '~/composables/useDeviceStartFlow'

const props = withDefaults(defineProps<{
  state: StartFlowState
  size?: 'sm' | 'md'
}>(), { size: 'md' })

const emit = defineEmits<{
  cancel: []
  /** Показать сырой ответ провайдера. */
  errorDetail: []
}>()

const showDownloadStep = computed(() =>
  props.state.hadDownload || props.state.step === 'downloading_core')

function formatSeconds(ms: number): string {
  if (ms < 1000) return '0 с'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} с`
  return `${Math.floor(seconds / 60)} м ${seconds % 60} с`
}

const waiting = computed(() => {
  if (props.state.downloadingCode === 'LOCK_PROFILE_ERROR') {
    return {
      label: 'Снятие блокировки',
      icon: 'mingcute:lock-line',
      retryInfo: `попытка ${props.state.lockRetries} из 5`,
    }
  }
  return {
    label: 'Загрузка ядра',
    icon: 'mingcute:download-line',
    retryInfo: props.state.coreRetries > 1 ? `попытка ${props.state.coreRetries} из 60` : '',
  }
})

type StepState = 'done' | 'running' | 'failed' | 'pending'

const steps = computed<Array<{ key: string, label: string, state: StepState, caption?: string }>>(() => {
  const s = props.state
  const launcher: StepState = s.step === 'launcher_call'
    ? 'running'
    : s.step === 'failed'
      ? (s.hadDownload ? 'done' : 'failed')
      : (s.step === 'downloading_core' || s.step === 'running' ? 'done' : 'pending')

  const download: StepState = s.step === 'downloading_core'
    ? 'running'
    : s.step === 'running'
      ? 'done'
      : s.step === 'failed' ? 'failed' : 'pending'

  const ready: StepState = s.step === 'running' ? 'done' : 'pending'

  const list: Array<{ key: string, label: string, state: StepState, caption?: string }> = [
    {
      key: 'launcher',
      label: 'Запуск',
      state: launcher,
      caption: s.step === 'launcher_call' ? formatSeconds(s.stepElapsedMs) : undefined,
    },
  ]
  if (showDownloadStep.value) {
    list.push({
      key: 'download',
      label: waiting.value.label,
      state: download,
      caption: s.step === 'downloading_core'
        ? [formatSeconds(s.stepElapsedMs), waiting.value.retryInfo].filter(Boolean).join(' · ')
        : undefined,
    })
  }
  list.push({
    key: 'ready',
    label: 'Готово',
    state: ready,
    caption: s.step === 'running' && s.port ? `:${s.port}` : undefined,
  })
  return list
})

const STEP_ICON: Record<StepState, string> = {
  done: 'mingcute:check-circle-line',
  running: 'mingcute:loading-line',
  failed: 'mingcute:close-circle-line',
  pending: 'mingcute:time-line',
}

const STEP_TONE: Record<StepState, string> = {
  done: 'text-success',
  running: 'text-info',
  failed: 'text-danger',
  pending: 'text-subtle',
}
</script>

<template>
  <div class="flex w-full flex-col gap-2">
    <UiStepProgress :steps="steps.map(s => s.state)" />

    <div class="flex flex-wrap gap-x-4 gap-y-1" :class="size === 'sm' ? 'text-micro' : 'text-sm'">
      <span v-for="s in steps" :key="s.key" class="flex items-center gap-1.5">
        <Icon
          :name="STEP_ICON[s.state]"
          :class="[STEP_TONE[s.state], s.state === 'running' && 'animate-spin']"
        />
        <span :class="s.state === 'pending' ? 'text-subtle' : 'text-fg'">{{ s.label }}</span>
        <span v-if="s.caption" class="tnum font-mono text-micro text-subtle">{{ s.caption }}</span>
      </span>
    </div>

    <p
      v-if="state.step === 'downloading_core'"
      role="status"
      class="flex flex-wrap items-center gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
    >
      <Icon :name="waiting.icon" class="shrink-0" />
      <span v-if="state.downloadingCode === 'LOCK_PROFILE_ERROR'" class="min-w-0 flex-1">
        Устройство держит блокировку профиля ({{ formatSeconds(state.stepElapsedMs) }},
        {{ waiting.retryInfo }}). Снимаем — обычно до пятнадцати секунд.
      </span>
      <span v-else class="min-w-0 flex-1">
        Устройство качает ядро Chromium через ваш прокси ({{ formatSeconds(state.stepElapsedMs) }}).
        Это разово после перезапуска контейнера — страницу можно закрыть, запуск продолжится.
      </span>
      <UiButton variant="ghost" @click="emit('cancel')">Отменить ожидание</UiButton>
    </p>

    <p
      v-else-if="state.step === 'failed'"
      role="alert"
      class="flex flex-wrap items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="shrink-0" />
      <span class="min-w-0 flex-1">{{ state.error?.message ?? 'Не удалось запустить' }}</span>
      <UiButton variant="ghost" @click="emit('errorDetail')">Подробнее</UiButton>
    </p>

    <div
      v-else-if="state.step === 'running'"
      role="status"
      class="flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
    >
      <Icon name="mingcute:check-circle-line" class="mt-0.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">Профиль запущен</span>
          <span class="tnum font-mono text-micro">{{ formatSeconds(state.elapsedMs) }}</span>
        </div>
        <p class="mt-0.5 text-muted">
          <template v-if="state.port">WebDriver слушает порт {{ state.port }}.</template>
          <template v-else>Устройство работает без WebDriver — управление через интерфейс провайдера.</template>
        </p>
      </div>
    </div>
  </div>
</template>
