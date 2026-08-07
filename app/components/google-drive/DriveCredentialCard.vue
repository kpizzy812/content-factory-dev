<script setup lang="ts">
import type { DriveCredential } from '~/composables/useGoogleDrive'

const props = defineProps<{
  credential: DriveCredential
  isSelected?: boolean
  isTesting?: boolean
}>()
const emit = defineEmits<{
  test: [credentialId: number]
  revoke: [credentialId: number]
  delete: [credentialId: number]
  selected: [credentialId: number]
}>()

// Подписи доменные («Отозван», «Не проверен»), тон — из общего словаря.
const status = computed(() => {
  const c = props.credential
  if (c.revokedAt) {
    return { tone: 'border-danger-border bg-danger-bg text-danger', label: 'Отозван' }
  }
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    return { tone: 'border-warning-border bg-warning-bg text-warning', label: 'Истёк' }
  }
  if (c.lastTestStatus === 'ok') {
    return { tone: 'border-success-border bg-success-bg text-success', label: 'OK' }
  }
  return { tone: 'border-info-border bg-info-bg text-info', label: 'Не проверен' }
})

const email = computed(() => {
  const meta = props.credential.metadata
  if (!meta || typeof meta !== 'object') return null
  const value = (meta as Record<string, unknown>).clientEmail
  return typeof value === 'string' && value.length > 0 ? value : null
})

const lastTestedRel = computed(() => {
  if (!props.credential.lastTestedAt) return null
  const t = new Date(props.credential.lastTestedAt).getTime()
  const diffMs = Date.now() - t
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const days = Math.floor(hr / 24)
  return `${days} дн назад`
})

// Удаление необратимо — спрашиваем модалкой, а не confirm().
const deleteConfirmRef = ref<{ open: () => void, close: () => void } | null>(null)

function onDeleteConfirmed() {
  deleteConfirmRef.value?.close()
  emit('delete', props.credential.id)
}
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-lg border bg-panel p-4 shadow-sm"
    :class="isSelected ? 'border-accent' : 'border-border'"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="min-w-0 font-semibold">{{ credential.name }}</h3>
      <span
        class="inline-flex h-[22px] shrink-0 items-center rounded-sm border px-2 text-sm"
        :class="status.tone"
      >{{ status.label }}</span>
    </div>

    <p v-if="credential.description" class="line-clamp-2 text-muted">
      {{ credential.description }}
    </p>

    <div class="flex flex-col gap-1 text-sm text-muted">
      <div v-if="email" class="flex items-center gap-1">
        <Icon name="mingcute:mail-line" class="shrink-0" />
        <span class="truncate">{{ email }}</span>
      </div>
      <ClientOnly>
        <div v-if="lastTestedRel" class="flex items-center gap-1">
          <Icon name="mingcute:time-line" class="shrink-0" />
          <span>Проверен: {{ lastTestedRel }}</span>
        </div>
      </ClientOnly>
    </div>

    <div class="mt-1 flex flex-wrap justify-end gap-1">
      <UiButton
        variant="ghost"
        :disabled="!!credential.revokedAt"
        :loading="isTesting"
        @click="emit('test', credential.id)"
      >
        <Icon v-if="!isTesting" name="mingcute:check-circle-line" />
        Тест
      </UiButton>

      <UiButton
        v-if="!credential.revokedAt && !isSelected"
        variant="primary"
        @click="emit('selected', credential.id)"
      >
        <Icon name="mingcute:right-line" />
        Выбрать
      </UiButton>

      <UiButton v-if="!credential.revokedAt" variant="ghost" @click="emit('revoke', credential.id)">
        <Icon name="mingcute:lock-line" class="text-warning" />
        Отозвать
      </UiButton>

      <UiButton variant="ghost" @click="deleteConfirmRef?.open()">
        <Icon name="mingcute:delete-2-line" class="text-danger" />
        Удалить
      </UiButton>
    </div>

    <SharedConfirmModal
      ref="deleteConfirmRef"
      title="Удалить учётные данные?"
      :message="`«${credential.name}» будет удалён без возможности восстановления. Конвейеры, использующие этот аккаунт, перестанут работать с Drive.`"
      confirm-label="Удалить"
      variant="danger"
      @confirm="onDeleteConfirmed"
    />
  </div>
</template>
