<script setup lang="ts">
/**
 * Прогрев профиля перед постингом.
 *
 * Поднимает профиль на серверном агенте тем же запуском, что и обычный старт,
 * но всегда с автоматизацией: раннер публикации в фазе старта сессии находит
 * профиль уже поднятым и не падает на загрузке ядра.
 *
 * Для мобильных профилей кнопка скрыта: там постинг идёт другим транспортом,
 * и такой прогрев ничего не даёт.
 */
import type { DeviceTestPushResult } from '~~/shared/types/device-profile'

const props = withDefaults(defineProps<{
  /** Локальный идентификатор профиля, не облачный. */
  profileId?: string | null
  /** Без облачной копии запуск невозможен — та же проверка, что у старта. */
  pushedToCloud?: boolean
  platformType?: 'desktop' | 'mobile_android' | 'mobile_ios' | null
  size?: 'sm' | 'md'
  /** Компактный режим для строки чек-листа. */
  compact?: boolean
}>(), { profileId: null, pushedToCloud: false, platformType: null, size: 'sm', compact: false })

const emit = defineEmits<{
  warmed: [port: number | null]
  updated: []
  errorDetail: [result: DeviceTestPushResult]
}>()

const {
  state: flowState,
  start: startFlow,
  cancel: cancelFlow,
  reset: resetFlow,
} = useDeviceStartFlow()

const supported = computed(() =>
  props.platformType !== 'mobile_android' && props.platformType !== 'mobile_ios')
const visible = computed(() => Boolean(props.profileId) && props.pushedToCloud && supported.value)

async function handleWarmup() {
  if (!props.profileId) return
  await startFlow(props.profileId, true)
  if (flowState.value.step === 'running') {
    emit('warmed', flowState.value.port)
    emit('updated')
  }
}

function handleErrorDetail() {
  const err = flowState.value.error
  if (!err) return
  emit('errorDetail', {
    ok: false,
    status: 0,
    // Прогрев — это запуск с автоматизацией, отдельного метода в контракте нет.
    method: 'start',
    url: '',
    requestBody: { automation: true },
    responseBody: err.indigoBody ?? null,
    error: err.message,
    phase: err.phase,
  })
}
</script>

<template>
  <div v-if="visible" class="contents">
    <UiButton
      v-if="flowState.step === 'idle'"
      variant="primary"
      :size="compact ? 'sm' : size"
      title="Поднять профиль на сервере заранее, чтобы постинг не падал на загрузке ядра"
      @click="handleWarmup"
    >
      <Icon name="mingcute:fire-line" />
      Прогреть
    </UiButton>

    <div
      v-else
      class="rounded-md border border-border bg-card p-3"
      :class="compact ? 'min-w-0' : 'w-full'"
    >
      <DeviceStartProgressStepper
        :state="flowState"
        :size="compact ? 'sm' : size"
        @cancel="cancelFlow"
        @error-detail="handleErrorDetail"
      />
      <div
        v-if="flowState.step === 'running' || flowState.step === 'failed'"
        class="mt-2 flex justify-end"
      >
        <UiButton variant="ghost" @click="resetFlow">Понятно</UiButton>
      </div>
    </div>
  </div>
</template>
