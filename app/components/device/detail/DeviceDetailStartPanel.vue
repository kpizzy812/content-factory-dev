<script setup lang="ts">
/**
 * Панель запуска: предупреждение о тарификации, флажок автоматизации и прогресс.
 *
 * Кнопки запуска живут в шапке страницы, а состояние — здесь: пока идёт
 * загрузка ядра, оператору нужно видеть, на каком шаге всё стоит, и уметь
 * прекратить ожидание, не трогая само устройство.
 */
import type { StartFlowState } from '~/composables/useDeviceStartFlow'
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

defineProps<{
  profile: DeviceProfileDto
  flowState: StartFlowState
  /** Ошибка последнего действия — общая для запуска, остановки и пуша. */
  error?: string | null
}>()

const automation = defineModel<boolean>('automation', { default: false })

const emit = defineEmits<{
  cancel: []
  reset: []
  errorDetail: []
}>()
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Запуск</h2>

    <DeviceCostWarning
      v-if="profile.indigoId && profile.sessionState !== 'running' && flowState.step === 'idle'"
      variant="alert"
    />

    <UiCheckbox
      v-if="profile.sessionState !== 'running' && flowState.step === 'idle'"
      v-model="automation"
      label="С автоматизацией — запуск отдаёт порт WebDriver"
    />

    <template v-if="flowState.step !== 'idle'">
      <DeviceStartProgressStepper
        :state="flowState"
        @cancel="emit('cancel')"
        @error-detail="emit('errorDetail')"
      />
      <div
        v-if="flowState.step === 'running' || flowState.step === 'failed'"
        class="flex justify-end"
      >
        <UiButton variant="ghost" @click="emit('reset')">Понятно</UiButton>
      </div>
    </template>

    <p
      v-else-if="!profile.indigoId"
      class="text-sm text-muted"
    >
      Профиля нет в облаке — сначала «Запушить», иначе запускать нечего.
    </p>

    <p
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </p>
  </section>
</template>
