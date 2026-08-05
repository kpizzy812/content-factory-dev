<script setup lang="ts">
/**
 * Подтверждение необратимого действия.
 *
 * Открывается императивно через ref — так его зовут страницы, где кнопка
 * удаления живёт внутри карточки списка и своего состояния не держит.
 */
type ConfirmVariant = 'danger' | 'warning' | 'primary'

withDefaults(defineProps<{
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}>(), {
  title: 'Подтвердить действие?',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'danger',
})

const emit = defineEmits<{ confirm: [], cancel: [] }>()

const isOpen = ref(false)
const isBusy = ref(false)

function open() {
  isBusy.value = false
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('cancel')
}

function setBusy(value: boolean) {
  isBusy.value = value
}

defineExpose({ open, close, setBusy })
</script>

<template>
  <UiModal :open="isOpen" :title="title" size="sm" :persistent="isBusy" @close="close">
    <p v-if="message" class="text-sm text-muted">{{ message }}</p>

    <template #footer>
      <UiButton variant="ghost" :disabled="isBusy" @click="close">{{ cancelLabel }}</UiButton>
      <UiButton
        :variant="variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : 'secondary'"
        :loading="isBusy"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>
