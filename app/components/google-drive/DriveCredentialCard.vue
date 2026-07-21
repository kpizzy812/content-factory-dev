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

const status = computed(() => {
  const c = props.credential
  if (c.revokedAt) {
    return { class: 'badge-error', label: 'Отозван' }
  }
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    return { class: 'badge-warning', label: 'Истёк' }
  }
  if (c.lastTestStatus === 'ok') {
    return { class: 'badge-success', label: 'OK' }
  }
  return { class: 'badge-info', label: 'Не проверен' }
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

function handleDelete() {
  if (!confirm(`Удалить credential "${props.credential.name}"? Действие необратимо.`)) return
  emit('delete', props.credential.id)
}
</script>

<template>
  <div
    class="card card-border bg-base-100 shadow-sm"
    :class="{ 'border-primary border-2': isSelected }"
  >
    <div class="card-body p-4">
      <div class="flex items-start justify-between gap-2">
        <h3 class="card-title text-base">{{ credential.name }}</h3>
        <span class="badge" :class="status.class">{{ status.label }}</span>
      </div>

      <p v-if="credential.description" class="text-sm text-base-content/70 line-clamp-2">
        {{ credential.description }}
      </p>

      <div class="text-xs text-base-content/60 space-y-1 mt-1">
        <div v-if="email" class="flex items-center gap-1">
          <Icon name="mingcute:mail-line" class="h-3 w-3" />
          <span class="truncate">{{ email }}</span>
        </div>
        <div v-if="lastTestedRel" class="flex items-center gap-1">
          <Icon name="mingcute:time-line" class="h-3 w-3" />
          <span>Проверен: {{ lastTestedRel }}</span>
        </div>
      </div>

      <div class="card-actions justify-end mt-2 flex-wrap gap-1">
        <button
          class="btn btn-xs btn-ghost"
          :disabled="isTesting || !!credential.revokedAt"
          @click="emit('test', credential.id)"
        >
          <span v-if="isTesting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:check-circle-line" class="h-3 w-3" />
          Тест
        </button>

        <button
          v-if="!credential.revokedAt && !isSelected"
          class="btn btn-xs btn-primary"
          @click="emit('selected', credential.id)"
        >
          <Icon name="mingcute:right-line" class="h-3 w-3" />
          Выбрать
        </button>

        <button
          v-if="!credential.revokedAt"
          class="btn btn-xs btn-ghost text-warning"
          @click="emit('revoke', credential.id)"
        >
          <Icon name="mingcute:lock-line" class="h-3 w-3" />
          Отозвать
        </button>

        <button class="btn btn-xs btn-ghost text-error" @click="handleDelete">
          <Icon name="mingcute:delete-2-line" class="h-3 w-3" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
